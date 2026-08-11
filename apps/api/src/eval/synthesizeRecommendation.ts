import { z } from "zod";
import { env } from "../config/env.js";
import { anthropic } from "../lib/anthropic.js";
import { extractJson } from "../lib/llmJson.js";
import { buildRecommendPrompt, type RecommendEvidenceInput } from "./prompts/recommend.js";

const promptDiffSchema = z
  .object({
    before: z.string(),
    after: z.string().min(1),
    insertAfterLine: z.number().int().positive().optional(),
  })
  .refine((d) => d.before !== "" || d.insertAfterLine !== undefined, {
    message: "insertAfterLine is required when before is empty (pure insertion)",
  });

const synthesizedRecommendationSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  promptDiff: promptDiffSchema,
});

export type SynthesizedRecommendation = z.infer<typeof synthesizedRecommendationSchema>;

export interface SynthesizeRecommendationInput {
  agentPrompt: string;
  criterionName: string;
  criterionDescription: string;
  rootCause: string;
  evidence: RecommendEvidenceInput[];
}

async function requestRecommendation(input: SynthesizeRecommendationInput, retryContext?: string): Promise<unknown> {
  const prompt = buildRecommendPrompt(
    input.agentPrompt,
    input.criterionName,
    input.criterionDescription,
    input.rootCause,
    input.evidence,
  );
  const userContent = retryContext
    ? `${prompt.user}\n\nYour previous response failed: ${retryContext}\nReturn valid JSON only.`
    : prompt.user;

  const response = await anthropic.messages.create({
    model: env.MODEL_SYNTHESIS,
    max_tokens: 2048,
    system: prompt.system,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic response had no text content block");
  }

  return extractJson(textBlock.text);
}

// promptDiff.before has to be a literal substring of the real agent prompt --
// the apply step does a plain string replace, not a fuzzy patch. A model that
// paraphrases instead of copying verbatim would silently corrupt the apply step
// later, so that's caught here and treated as a retryable failure, same as a
// JSON parse error.
function validateVerbatimBefore(
  result: SynthesizedRecommendation,
  agentPrompt: string,
): void {
  if (result.promptDiff.before !== "" && !agentPrompt.includes(result.promptDiff.before)) {
    throw new Error(
      `promptDiff.before is not a verbatim substring of the agent prompt: ${JSON.stringify(result.promptDiff.before)}`,
    );
  }
}

// Retries once with the failure appended, then fails loudly -- never accepts a
// partially-valid result (mirrors judge.ts / generateScorecard.ts).
export async function synthesizeRecommendation(
  input: SynthesizeRecommendationInput,
): Promise<SynthesizedRecommendation> {
  try {
    const raw = await requestRecommendation(input);
    const parsed = synthesizedRecommendationSchema.parse(raw);
    validateVerbatimBefore(parsed, input.agentPrompt);
    return parsed;
  } catch (firstErr) {
    const errorMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const raw = await requestRecommendation(input, errorMessage);
    const parsed = synthesizedRecommendationSchema.parse(raw);
    validateVerbatimBefore(parsed, input.agentPrompt);
    return parsed;
  }
}
