import { z } from "zod";
import { env } from "../config/env.js";
import { anthropic } from "../lib/anthropic.js";
import { extractJson } from "../lib/llmJson.js";
import { buildTestCasesPrompt, type ExistingTestCaseSummary } from "./prompts/testCases.js";

export type { ExistingTestCaseSummary } from "./prompts/testCases.js";

const transcriptTurnSchema = z.object({
  role: z.enum(["AGENT", "CALLER"]),
  text: z.string().min(1),
});

const generatedTestCaseSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "must be snake_case"),
  title: z.string().min(1),
  scenario: z.string().min(1),
  expectedResult: z.string().min(1),
  transcript: z.array(transcriptTurnSchema).min(2).max(14),
});

const generatedTestCasesArraySchema = z.array(generatedTestCaseSchema).min(1).max(8);

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;
export type GeneratedTestCase = z.infer<typeof generatedTestCaseSchema>;

async function requestTestCases(
  agentName: string,
  agentPrompt: string,
  existingTestCases: ExistingTestCaseSummary[],
  retryContext?: string,
): Promise<unknown> {
  const prompt = buildTestCasesPrompt(agentName, agentPrompt, existingTestCases);
  const userContent = retryContext
    ? `${prompt.user}\n\nYour previous response failed to parse: ${retryContext}\nReturn valid JSON only.`
    : prompt.user;

  // Same "temperature 0 everywhere" caveat as generateScorecard.ts: claude-sonnet-5
  // rejects the param outright, so it's omitted rather than guessing a replacement.
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
// partially-parsed result (mirrors generateScorecardCriteria's validation rule).
export async function synthesizeTestCases(
  agentName: string,
  agentPrompt: string,
  existingTestCases: ExistingTestCaseSummary[],
): Promise<GeneratedTestCase[]> {
  try {
    const raw = await requestTestCases(agentName, agentPrompt, existingTestCases);
    return generatedTestCasesArraySchema.parse(raw);
  } catch (firstErr) {
    const errorMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const raw = await requestTestCases(agentName, agentPrompt, existingTestCases, errorMessage);
    return generatedTestCasesArraySchema.parse(raw);
  }
}
