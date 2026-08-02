// Versioned per BUILD_SPEC §11. Structure matches §6.3's example exactly.
export const JUDGE_PROMPT_VERSION = "judge-v1";

export interface JudgeCriterionInput {
  key: string;
  name: string;
  description: string;
  category: string;
}

export interface JudgeTurnInput {
  idx: number;
  role: "AGENT" | "CALLER" | "SYSTEM";
  text: string;
}

export interface JudgePrompt {
  system: string;
  user: string;
}

export function buildJudgePrompt(
  agentPrompt: string,
  criteria: JudgeCriterionInput[],
  deterministicMetrics: Record<string, unknown>,
  turns: JudgeTurnInput[],
): JudgePrompt {
  const transcript = turns.map((t) => `[${t.idx}] ${t.role}: ${t.text}`).join("\n");

  return {
    system:
      "You are evaluating a completed voice AI phone call against a scorecard. " +
      "You are strict, evidence-based, and you never invent quotes.",
    user: `<agent_prompt>
${agentPrompt}
</agent_prompt>
<scorecard>${JSON.stringify(criteria)}</scorecard>
<deterministic_metrics>${JSON.stringify(deterministicMetrics)}</deterministic_metrics>
<transcript>
${transcript}
</transcript>

For each criterion return:
  criterionKey: the criterion's key, copied exactly from <scorecard>
  verdict: pass | partial | fail | not_applicable
  confidence: 0..1
  evidenceTurns: array of turn indices you actually used
  rationale: one sentence, cite what happened, no speculation
  rootCause: only when verdict is fail or partial, one of
    missing_instruction | ambiguous_instruction | knowledge_gap |
    flow_ordering | guardrail_missing | caller_side

Use not_applicable when the call never reached the situation the criterion
describes. Do not penalize an agent for a goal the caller never wanted.
Return JSON only: an array of objects, one per criterion, with exactly the fields
above.`,
  };
}
