import type {
  CriterionCategory,
  EvalMethod,
  Prisma,
  Scorecard,
  ScorecardSource,
  Severity,
} from "../../generated/prisma/client.js";
import { prisma } from "./client.js";

export interface CriterionInput {
  key: string;
  name: string;
  description: string;
  category: CriterionCategory;
  severity: Severity;
  weight: number;
  method: EvalMethod;
  deterministicRule?: Prisma.InputJsonValue;
}

export type ScorecardWithCriteria = Prisma.ScorecardGetPayload<{ include: { criteria: true } }>;

// Creates the next version for an agent's scorecard and deactivates the previous
// one, in one transaction. Old Criterion rows are never touched, so existing
// CriterionResult/Evaluation history stays intact -- this is what "editing and
// saving creates version 2 without breaking version 1's stored results" requires.
export async function createScorecardVersion(
  agentId: string,
  criteria: CriterionInput[],
  source: ScorecardSource,
): Promise<ScorecardWithCriteria> {
  return prisma.$transaction(async (tx) => {
    const previousActive = await tx.scorecard.findFirst({
      where: { agentId, isActive: true },
      orderBy: { version: "desc" },
    });

    if (previousActive) {
      await tx.scorecard.update({ where: { id: previousActive.id }, data: { isActive: false } });
    }

    return tx.scorecard.create({
      data: {
        agentId,
        version: (previousActive?.version ?? 0) + 1,
        isActive: true,
        source,
        criteria: { create: criteria },
      },
      include: { criteria: true },
    });
  });
}

export async function getActiveScorecard(agentId: string): Promise<ScorecardWithCriteria | null> {
  return prisma.scorecard.findFirst({
    where: { agentId, isActive: true },
    include: { criteria: true },
    orderBy: { version: "desc" },
  });
}

export async function getScorecardVersion(
  agentId: string,
  version: number,
): Promise<ScorecardWithCriteria | null> {
  return prisma.scorecard.findUnique({
    where: { agentId_version: { agentId, version } },
    include: { criteria: true },
  });
}

export async function listScorecardVersions(agentId: string): Promise<Scorecard[]> {
  return prisma.scorecard.findMany({ where: { agentId }, orderBy: { version: "desc" } });
}

export interface CriterionStat {
  criterionKey: string;
  name: string;
  category: CriterionCategory;
  passRate: number | null;
  trend: "up" | "down" | "flat" | null;
  failingCallCount: number;
}

const VERDICT_VALUES: Record<string, number | null> = {
  PASS: 1,
  PARTIAL: 0.5,
  FAIL: 0,
  NOT_APPLICABLE: null,
};

// Same weighting as eval/healthScore.ts's per-call formula, applied across many
// results instead of one call's results. Exported for reuse by recommendation
// impact tracking (db/recommendations.ts), which needs the identical formula for
// baseline-vs-current pass rate comparisons.
export function computePassRate(results: { verdict: string }[]): number | null {
  let sum = 0;
  let count = 0;
  for (const result of results) {
    const value = VERDICT_VALUES[result.verdict];
    if (value === null || value === undefined) continue;
    sum += value;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

// Feeds Agent Detail's criterion table and Overview's "top failing criterion"
// per agent card. Trend is a hand-rolled this-week-vs-last-week comparison, not
// a chart (BUILD_SPEC §3: no heavy dashboard framework).
export async function getCriterionStats(agentId: string): Promise<CriterionStat[]> {
  const scorecard = await getActiveScorecard(agentId);
  if (!scorecard) return [];

  const now = Date.now();
  const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);

  const results = await prisma.criterionResult.findMany({
    where: {
      criterionKey: { in: scorecard.criteria.map((c) => c.key) },
      evaluation: { call: { agentId } },
    },
    include: { evaluation: { select: { createdAt: true } } },
  });

  return scorecard.criteria.map((criterion) => {
    const criterionResults = results.filter((r) => r.criterionKey === criterion.key);
    const thisWeek = criterionResults.filter((r) => r.evaluation.createdAt >= oneWeekAgo);
    const lastWeek = criterionResults.filter(
      (r) => r.evaluation.createdAt >= twoWeeksAgo && r.evaluation.createdAt < oneWeekAgo,
    );

    const thisWeekRate = computePassRate(thisWeek);
    const lastWeekRate = computePassRate(lastWeek);
    let trend: CriterionStat["trend"] = null;
    if (thisWeekRate !== null && lastWeekRate !== null) {
      trend = thisWeekRate > lastWeekRate ? "up" : thisWeekRate < lastWeekRate ? "down" : "flat";
    }

    return {
      criterionKey: criterion.key,
      name: criterion.name,
      category: criterion.category,
      passRate: computePassRate(criterionResults),
      trend,
      failingCallCount: criterionResults.filter((r) => r.verdict === "FAIL").length,
    };
  });
}
