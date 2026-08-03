import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import { RootCause, Verdict } from "../../generated/prisma/client.js";
import { prisma } from "../db/client.js";
import { createEvaluation, findByInputHash } from "../db/evaluations.js";
import { getActiveScorecard } from "../db/scorecards.js";
import { checkForActionTriggers } from "./actionTriggers.js";
import { computeDeterministicMetrics } from "./deterministicChecks.js";
import { computeCallHealthScore } from "./healthScore.js";
import { judgeCall } from "./judge.js";
import { JUDGE_PROMPT_VERSION } from "./prompts/judge.js";

function computeInputHash(transcriptText: string, scorecardVersion: number, promptVersion: string): string {
  return createHash("sha256")
    .update(`${transcriptText}::${scorecardVersion}::${promptVersion}`)
    .digest("hex");
}

const VERDICT_MAP: Record<string, Verdict> = {
  pass: Verdict.PASS,
  partial: Verdict.PARTIAL,
  fail: Verdict.FAIL,
  not_applicable: Verdict.NOT_APPLICABLE,
};

const ROOT_CAUSE_MAP: Record<string, RootCause> = {
  missing_instruction: RootCause.MISSING_INSTRUCTION,
  ambiguous_instruction: RootCause.AMBIGUOUS_INSTRUCTION,
  knowledge_gap: RootCause.KNOWLEDGE_GAP,
  flow_ordering: RootCause.FLOW_ORDERING,
  guardrail_missing: RootCause.GUARDRAIL_MISSING,
  caller_side: RootCause.CALLER_SIDE,
};

// The orchestrator: cache check -> deterministic checks -> judge -> persist.
// Silently returns if the agent has no active scorecard yet -- nothing to
// evaluate against (BUILD_SPEC never anticipates evaluating without one).
export async function evaluateCall(callId: string): Promise<void> {
  const call = await prisma.call.findUniqueOrThrow({
    where: { id: callId },
    include: { turns: { orderBy: { idx: "asc" } }, agent: true },
  });

  const scorecard = await getActiveScorecard(call.agentId);
  if (!scorecard) return;

  const transcriptForHash = call.turns.map((t) => `${t.role}:${t.text}`).join("\n");
  const inputHash = computeInputHash(transcriptForHash, scorecard.version, JUDGE_PROMPT_VERSION);

  // Cache hit -- zero API calls (§6.3).
  const existing = await findByInputHash(callId, inputHash);
  if (existing) return;

  const deterministicMetrics = computeDeterministicMetrics(call, call.turns, call.agent.actions);

  // DETERMINISTIC-method criteria have no defined deterministicRule shape yet
  // (Phase 3 scope decision) -- only LLM-method criteria are actually evaluated
  // today. None exist in practice yet, but the filter is here for when they do.
  const llmCriteria = scorecard.criteria.filter((c) => c.method === "LLM");

  const judgeResults = llmCriteria.length
    ? await judgeCall(
        call.agent.promptSnapshot,
        llmCriteria.map((c) => ({
          key: c.key,
          name: c.name,
          description: c.description,
          category: c.category,
        })),
        deterministicMetrics as unknown as Record<string, unknown>,
        call.turns.map((t) => ({ idx: t.idx, role: t.role, text: t.text })),
      )
    : [];

  const results = judgeResults.map((r) => ({
    criterionKey: r.criterionKey,
    verdict: VERDICT_MAP[r.verdict],
    confidence: r.confidence,
    evidenceTurns: r.evidenceTurns,
    rationale: r.lowTrust ? `[low-trust: no valid evidence turns] ${r.rationale}` : r.rationale,
    rootCause: r.rootCause ? ROOT_CAUSE_MAP[r.rootCause] : undefined,
  }));

  const weightByKey = new Map(scorecard.criteria.map((c) => [c.key, c.weight]));
  const healthScore = computeCallHealthScore(
    results.map((r) => ({ verdict: r.verdict, weight: weightByKey.get(r.criterionKey) ?? 1 })),
  );

  await createEvaluation({
    callId,
    scorecardVersion: scorecard.version,
    promptVersion: JUDGE_PROMPT_VERSION,
    inputHash,
    // healthScore is non-nullable in the schema; 0 when every criterion came back
    // not_applicable (denominator zero) is a known imperfect default, not a real
    // "total failure" signal -- rare edge case, not worth a schema change for.
    healthScore: healthScore ?? 0,
    metrics: deterministicMetrics as unknown as Prisma.InputJsonValue,
    results,
  });

  await checkForActionTriggers(
    callId,
    results.map((r) => ({ criterionKey: r.criterionKey, verdict: r.verdict })),
    scorecard.criteria.map((c) => ({ key: c.key, severity: c.severity, category: c.category })),
  );
}
