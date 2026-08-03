import type { Prisma, Recommendation } from "../../generated/prisma/client.js";
import { prisma } from "../db/client.js";
import {
  createRecommendation,
  findFailureClusters,
  getRecommendedKeys,
  type FailureCluster,
} from "../db/recommendations.js";
import { synthesizeRecommendation } from "./synthesizeRecommendation.js";

// Orchestrator, mirrors evaluateCall.ts's role: composes db/ queries with an LLM
// call and persists the result. Clusters repeated failures, skips anything
// already recommended (open, applied, or dismissed), synthesizes a minimal fix
// per remaining cluster, persists it. Manually triggered (a button on Agent
// Detail), not run automatically after every evaluation -- BUILD_SPEC's Phase 6
// title says "and the loop" but an on-demand loop is what was chosen here for
// predictable timing over a background trigger.
export async function generateRecommendationsForAgent(
  agentId: string,
  agentPrompt: string,
): Promise<Recommendation[]> {
  const [clusters, alreadyRecommended] = await Promise.all([
    findFailureClusters(agentId),
    getRecommendedKeys(agentId),
  ]);

  const newClusters = clusters.filter(
    (c) => !alreadyRecommended.has(`${c.criterionKey}::${c.rootCause}`),
  );
  if (newClusters.length === 0) return [];

  const created: Recommendation[] = [];
  for (const cluster of newClusters) {
    const criterion = await getCriterionForCluster(agentId, cluster);
    // Criterion no longer exists in any scorecard version (e.g. removed in a
    // later edit) -- skip rather than recommend a fix for a criterion nobody
    // scores against anymore.
    if (!criterion) continue;

    const synthesized = await synthesizeRecommendation({
      agentPrompt,
      criterionName: criterion.name,
      criterionDescription: criterion.description,
      rootCause: cluster.rootCause,
      evidence: cluster.synthesisEvidence,
    });

    const rec = await createRecommendation({
      agentId,
      criterionKey: cluster.criterionKey,
      rootCause: cluster.rootCause,
      title: synthesized.title,
      body: synthesized.body,
      promptDiff: synthesized.promptDiff as Prisma.InputJsonValue,
      affectedCalls: cluster.affectedCalls,
      affectedPct: cluster.affectedPct,
      severity: criterion.severity,
      evidenceCallIds: cluster.evidenceCallIds,
    });
    created.push(rec);
  }

  return created;
}

// criterionKey is deliberately not a Criterion.id foreign key (survives
// scorecard version bumps), so this is the same findFirst-by-key-then-latest
// lookup used in db/insights.ts and db/scorecards.ts.
async function getCriterionForCluster(agentId: string, cluster: FailureCluster) {
  return prisma.criterion.findFirst({
    where: { key: cluster.criterionKey, scorecard: { agentId } },
    orderBy: { scorecard: { version: "desc" } },
    select: { name: true, description: true, severity: true },
  });
}
