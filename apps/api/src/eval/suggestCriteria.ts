import { z } from "zod";
import { env } from "../config/env.js";
import { anthropic } from "../lib/anthropic.js";
import { extractJson } from "../lib/llmJson.js";
import { generatedCriterionSchema, type GeneratedCriterion } from "./generateScorecard.js";
import {
  buildSuggestCriteriaPrompt,
  type ExistingCriterionSummary,
} from "./prompts/suggestCriteria.js";

export type { ExistingCriterionSummary } from "./prompts/suggestCriteria.js";

const suggestCriteriaResponseSchema = z.object({
  useCase: z.string().min(1).max(160),
  suggestions: z.array(generatedCriterionSchema).max(6),
});

export interface SuggestedCriteria {
  useCase: string;
  suggestions: GeneratedCriterion[];
}

async function requestSuggestions(
  agentName: string,
  agentPrompt: string,
  existingCriteria: ExistingCriterionSummary[],
  retryContext?: string,
): Promise<unknown> {
  const prompt = buildSuggestCriteriaPrompt(agentName, agentPrompt, existingCriteria);
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

// A collision is not a parse failure, so it's filtered after a successful parse
// rather than folded into the retry path -- cheapest hallucination/duplication
// guard available, mirroring BUILD_SPEC §6.3's "drop invalid evidenceTurns" rule.
function dropCollisions(
  suggestions: GeneratedCriterion[],
  existingCriteria: ExistingCriterionSummary[],
): GeneratedCriterion[] {
  const existingKeys = new Set(existingCriteria.map((c) => c.key));
  const seenKeys = new Set<string>();
  const kept: GeneratedCriterion[] = [];
  for (const suggestion of suggestions) {
    if (existingKeys.has(suggestion.key) || seenKeys.has(suggestion.key)) continue;
    seenKeys.add(suggestion.key);
    kept.push(suggestion);
  }
  return kept;
}

// Retries once with the parse error appended, then fails loudly -- never accepts a
// partially-parsed result (mirrors generateScorecardCriteria's validation rule).
export async function suggestScorecardCriteria(
  agentName: string,
  agentPrompt: string,
  existingCriteria: ExistingCriterionSummary[],
): Promise<SuggestedCriteria> {
  let parsed: z.infer<typeof suggestCriteriaResponseSchema>;
  try {
    const raw = await requestSuggestions(agentName, agentPrompt, existingCriteria);
    parsed = suggestCriteriaResponseSchema.parse(raw);
  } catch (firstErr) {
    const errorMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const raw = await requestSuggestions(agentName, agentPrompt, existingCriteria, errorMessage);
    parsed = suggestCriteriaResponseSchema.parse(raw);
  }

  return {
    useCase: parsed.useCase,
    suggestions: dropCollisions(parsed.suggestions, existingCriteria),
  };
}
