import type { Prisma, Recommendation, RecStatus, RootCause } from "../../generated/prisma/client.js";
import { computePassRate } from "./scorecards.js";
import { prisma } from "./client.js";

export interface ListRecommendationsFilters {
  agentId?: string;
  status?: RecStatus;
}

export type ImpactState = "not_applied" | "collecting_data" | "improved" | "unchanged" | "worse";

export interface RecommendationImpact {
  state: ImpactState;
  baselineRate: number | null;
  currentRate: number | null;
}

export interface RecommendationWithImpact extends Recommendation {
  impact: RecommendationImpact;
}

// currentRate is the pass rate for this recommendation's criterion among calls
// evaluated strictly after appliedAt -- "collecting_data" is the exact state
// BUILD_SPEC's Phase 6 acceptance criterion names for the case where nothing has
// been evaluated since the fix went live yet.
async function computeImpact(rec: Recommendation): Promise<RecommendationImpact> {
  if (rec.status !== "APPLIED" || !rec.appliedAt) {
    return { state: "not_applied", baselineRate: rec.baselineRate, currentRate: null };
  }

  const resultsSinceApply = await prisma.criterionResult.findMany({
    where: {
      criterionKey: rec.criterionKey,
      evaluation: { call: { agentId: rec.agentId }, createdAt: { gt: rec.appliedAt } },
    },
    select: { verdict: true },
  });

  const currentRate = computePassRate(resultsSinceApply);
  if (currentRate === null) {
    return { state: "collecting_data", baselineRate: rec.baselineRate, currentRate: null };
  }

  const baseline = rec.baselineRate;
  let state: ImpactState = "unchanged";
  if (baseline !== null) {
    state = currentRate > baseline ? "improved" : currentRate < baseline ? "worse" : "unchanged";
  }
  return { state, baselineRate: baseline, currentRate };
}

// Recommendation.agentId is a plain scalar, not a Prisma relation (same
// reasoning as db/insights.ts) -- tenant scoping resolves this location's agent
// ids first.
export async function listRecommendations(
  locationId: string,
  filters: ListRecommendationsFilters,
): Promise<RecommendationWithImpact[]> {
  const agents = await prisma.agent.findMany({ where: { locationId }, select: { id: true } });
  const agentIds = agents.map((a) => a.id);

  const recommendations = await prisma.recommendation.findMany({
    where: {
      agentId: filters.agentId ?? { in: agentIds },
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(recommendations.map(async (rec) => ({ ...rec, impact: await computeImpact(rec) })));
}

export interface RecommendationEvidence {
  rationale: string;
  turns: { idx: number; role: string; text: string }[];
}

export interface FailureCluster {
  criterionKey: string;
  rootCause: RootCause;
  affectedCalls: number;
  affectedPct: number;
  evidenceCallIds: string[];
  synthesisEvidence: RecommendationEvidence[];
}

// Deliberately low for sparse real/demo data -- a production default guarding
// against noisy one-off recommendations would be higher (5+), but this project's
// real call volume will rarely clear that bar. Tunable, not load-bearing elsewhere.
const MIN_CLUSTER_SIZE = 2;
const MAX_SYNTHESIS_EVIDENCE = 3;
const MAX_EVIDENCE_CALL_IDS = 5;

// Groups repeated FAIL/PARTIAL results by (criterionKey, rootCause) across all of
// an agent's evaluated calls. CriterionResult -> Evaluation -> Call are real
// Prisma relations (unlike the scalar-FK pattern used for Recommendation.agentId
// elsewhere), so this is a direct nested-relation query, no resolve-ids-first step.
export async function findFailureClusters(agentId: string): Promise<FailureCluster[]> {
  const [results, totalEvaluatedCalls] = await Promise.all([
    prisma.criterionResult.findMany({
      where: {
        verdict: { in: ["FAIL", "PARTIAL"] },
        rootCause: { not: null },
        evaluation: { call: { agentId } },
      },
      include: { evaluation: { select: { callId: true, createdAt: true } } },
      orderBy: { evaluation: { createdAt: "desc" } },
    }),
    prisma.evaluation.count({ where: { call: { agentId } } }),
  ]);

  const groups = new Map<string, typeof results>();
  for (const result of results) {
    const key = `${result.criterionKey}::${result.rootCause}`;
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }

  const clusters: FailureCluster[] = [];
  for (const group of groups.values()) {
    const distinctCallIds = [...new Set(group.map((r) => r.evaluation.callId))];
    if (distinctCallIds.length < MIN_CLUSTER_SIZE) continue;

    const sample = group.slice(0, MAX_SYNTHESIS_EVIDENCE);
    const synthesisEvidence = await Promise.all(
      sample.map(async (result): Promise<RecommendationEvidence> => {
        const turns = result.evidenceTurns.length
          ? await prisma.turn.findMany({
              where: { callId: result.evaluation.callId, idx: { in: result.evidenceTurns } },
              orderBy: { idx: "asc" },
              select: { idx: true, role: true, text: true },
            })
          : [];
        return { rationale: result.rationale, turns };
      }),
    );

    clusters.push({
      criterionKey: group[0].criterionKey,
      // Non-null guaranteed by the `rootCause: { not: null }` filter above.
      rootCause: group[0].rootCause as RootCause,
      affectedCalls: distinctCallIds.length,
      affectedPct: totalEvaluatedCalls > 0 ? distinctCallIds.length / totalEvaluatedCalls : 0,
      evidenceCallIds: distinctCallIds.slice(0, MAX_EVIDENCE_CALL_IDS),
      synthesisEvidence,
    });
  }

  return clusters;
}

export async function createRecommendation(data: {
  agentId: string;
  criterionKey: string;
  rootCause: RootCause;
  title: string;
  body: string;
  promptDiff: Prisma.InputJsonValue;
  affectedCalls: number;
  affectedPct: number;
  severity: Recommendation["severity"];
  evidenceCallIds: string[];
}): Promise<Recommendation> {
  return prisma.recommendation.create({ data: { ...data, status: "OPEN" } });
}

// Resolves a recommendation scoped to a location the same way calls/actions are
// scoped elsewhere: through the owning agent's locationId, since Recommendation
// has no locationId column of its own.
export async function getRecommendationById(locationId: string, id: string): Promise<Recommendation | null> {
  const rec = await prisma.recommendation.findUnique({ where: { id } });
  if (!rec) return null;
  const agent = await prisma.agent.findFirst({ where: { id: rec.agentId, locationId }, select: { id: true } });
  return agent ? rec : null;
}

export async function markRecommendationApplied(id: string, baselineRate: number | null): Promise<Recommendation> {
  return prisma.recommendation.update({
    where: { id },
    data: { status: "APPLIED", appliedAt: new Date(), baselineRate },
  });
}

export async function markRecommendationDismissed(id: string): Promise<Recommendation> {
  return prisma.recommendation.update({ where: { id }, data: { status: "DISMISSED" } });
}

// Every (criterionKey, rootCause) combo that already has ANY recommendation row
// (OPEN, APPLIED, or DISMISSED) is skipped -- an open one shouldn't be duplicated,
// an applied one already has its fix live, and a dismissed one was explicitly
// rejected by a human and must not resurface on the next click.
export async function getRecommendedKeys(agentId: string): Promise<Set<string>> {
  const existing = await prisma.recommendation.findMany({
    where: { agentId },
    select: { criterionKey: true, rootCause: true },
  });
  return new Set(existing.map((r) => `${r.criterionKey}::${r.rootCause}`));
}
