import { z } from "zod";
import { env } from "../config/env.js";
import { anthropic } from "../lib/anthropic.js";
import { buildScorecardGenerationPrompt } from "./prompts/scorecardGeneration.js";

const generatedCriterionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "must be snake_case"),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(["goal", "data_capture", "knowledge", "containment", "compliance", "conversational"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  weight: z.number().positive(),
});

const generatedCriteriaArraySchema = z.array(generatedCriterionSchema).min(6).max(10);

export type GeneratedCriterion = z.infer<typeof generatedCriterionSchema>;

// Models sometimes wrap JSON in a code fence despite a "JSON only" instruction.
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1] : text);
}

async function requestCriteria(agentPrompt: string, retryContext?: string): Promise<unknown> {
  const prompt = buildScorecardGenerationPrompt(agentPrompt);
  const userContent = retryContext
    ? `${prompt.user}\n\nYour previous response failed to parse: ${retryContext}\nReturn valid JSON only.`
    : prompt.user;

  // BUILD_SPEC says "temperature 0 everywhere," but claude-sonnet-5 rejects the
  // temperature param outright ("deprecated for this model") -- confirmed via a
  // live call, not assumed. Omitted rather than guessing at a replacement param.
  const response = await anthropic.messages.create({
    model: env.MODEL_SYNTHESIS,
    max_tokens: 4096,
    system: prompt.system,
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic response had no text content block");
  }

  return extractJson(textBlock.text);
}

// Retries once with the parse error appended, then fails loudly -- never accepts a
// partially-parsed result (mirrors the judge's validation rule in BUILD_SPEC §6.3).
export async function generateScorecardCriteria(agentPrompt: string): Promise<GeneratedCriterion[]> {
  try {
    const raw = await requestCriteria(agentPrompt);
    return generatedCriteriaArraySchema.parse(raw);
  } catch (firstErr) {
    const errorMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const raw = await requestCriteria(agentPrompt, errorMessage);
    return generatedCriteriaArraySchema.parse(raw);
  }
}
