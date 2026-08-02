import { z } from "zod";
import { env } from "../config/env.js";
import { anthropic } from "../lib/anthropic.js";
import { buildJudgePrompt, type JudgeCriterionInput, type JudgeTurnInput } from "./prompts/judge.js";

const judgeResultSchema = z.object({
  criterionKey: z.string(),
  verdict: z.enum(["pass", "partial", "fail", "not_applicable"]),
  confidence: z.number().min(0).max(1),
  evidenceTurns: z.array(z.number().int()),
  rationale: z.string().min(1),
  rootCause: z
    .enum([
      "missing_instruction",
      "ambiguous_instruction",
      "knowledge_gap",
      "flow_ordering",
      "guardrail_missing",
      "caller_side",
    ])
    .optional(),
});

const judgeResponseSchema = z.array(judgeResultSchema);

export type JudgeResult = z.infer<typeof judgeResultSchema>;
export interface ValidatedJudgeResult extends JudgeResult {
  lowTrust: boolean;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1] : text);
}

async function requestJudgement(
  agentPrompt: string,
  criteria: JudgeCriterionInput[],
  deterministicMetrics: Record<string, unknown>,
  turns: JudgeTurnInput[],
  retryContext?: string,
): Promise<unknown> {
  const prompt = buildJudgePrompt(agentPrompt, criteria, deterministicMetrics, turns);
  const userContent = retryContext
    ? `${prompt.user}\n\nYour previous response failed to parse: ${retryContext}\nReturn valid JSON only.`
    : prompt.user;

  const response = await anthropic.messages.create({
    model: env.MODEL_EVAL,
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

// Drops any evidenceTurns index that doesn't exist on the call, flags the result
// low-trust if ALL indices were invalid -- the cheapest hallucination guard
// available (§6.3).
function validateEvidenceTurns(results: JudgeResult[], validTurnIndices: Set<number>): ValidatedJudgeResult[] {
  return results.map((result) => {
    const originalCount = result.evidenceTurns.length;
    const validIndices = result.evidenceTurns.filter((idx) => validTurnIndices.has(idx));
    const lowTrust = originalCount > 0 && validIndices.length === 0;
    return { ...result, evidenceTurns: validIndices, lowTrust };
  });
}

// One request per call, all LLM criteria batched. Retries once with the parse
// error appended, then fails loudly -- never accepts a partially-parsed result
// (§6.3).
export async function judgeCall(
  agentPrompt: string,
  criteria: JudgeCriterionInput[],
  deterministicMetrics: Record<string, unknown>,
  turns: JudgeTurnInput[],
): Promise<ValidatedJudgeResult[]> {
  const validTurnIndices = new Set(turns.map((t) => t.idx));

  let parsed: JudgeResult[];
  try {
    const raw = await requestJudgement(agentPrompt, criteria, deterministicMetrics, turns);
    parsed = judgeResponseSchema.parse(raw);
  } catch (firstErr) {
    const errorMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const raw = await requestJudgement(agentPrompt, criteria, deterministicMetrics, turns, errorMessage);
    parsed = judgeResponseSchema.parse(raw);
  }

  return validateEvidenceTurns(parsed, validTurnIndices);
}
