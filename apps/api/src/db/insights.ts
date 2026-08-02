import { prisma } from "./client.js";

export interface TaxonomyRow {
  rootCause: string;
  count: number;
}

export interface OverviewStats {
  callsAnalyzed: number;
  meanAgentHealth: number | null;
  openRecommendations: number;
  actionQueueDepth: number;
  taxonomy: TaxonomyRow[];
}

// Recommendation.agentId and ActionItem.callId are plain scalar fields, not
// Prisma relations (BUILD_SPEC §5's own sketch never declares the reverse arrays
// on Agent/Call) -- so tenant scoping here means resolving this location's
// agent/call ids first, then filtering by `in`, rather than a nested relation
// filter Prisma can't express.
export async function getOverviewStats(locationId: string): Promise<OverviewStats> {
  const [agents, calls] = await Promise.all([
    prisma.agent.findMany({ where: { locationId }, select: { id: true } }),
    prisma.call.findMany({ where: { locationId }, select: { id: true } }),
  ]);
  const agentIds = agents.map((a) => a.id);
  const callIds = calls.map((c) => c.id);

  const [callsAnalyzed, openRecommendations, actionQueueDepth, taxonomyRaw, healthScores] = await Promise.all([
    prisma.evaluation.count({ where: { callId: { in: callIds } } }),
    prisma.recommendation.count({ where: { agentId: { in: agentIds }, status: "OPEN" } }),
    prisma.actionItem.count({ where: { callId: { in: callIds }, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.criterionResult.groupBy({
      by: ["rootCause"],
      where: { rootCause: { not: null }, evaluation: { callId: { in: callIds } } },
      _count: { rootCause: true },
    }),
    prisma.evaluation.findMany({ where: { callId: { in: callIds } }, select: { healthScore: true } }),
  ]);

  const meanAgentHealth = healthScores.length
    ? healthScores.reduce((sum, e) => sum + e.healthScore, 0) / healthScores.length
    : null;

  const taxonomy: TaxonomyRow[] = taxonomyRaw
    .filter((row): row is typeof row & { rootCause: string } => row.rootCause !== null)
    .map((row) => ({ rootCause: row.rootCause, count: row._count.rootCause }));

  return { callsAnalyzed, meanAgentHealth, openRecommendations, actionQueueDepth, taxonomy };
}

export interface RecentFinding {
  callId: string;
  agentName: string;
  criterionKey: string;
  rationale: string;
  createdAt: Date;
}

// criterionKey is deliberately not a Criterion.id foreign key (BUILD_SPEC §5:
// "join on criterionKey, never on Criterion.id" -- has to survive scorecard
// version bumps), so severity has to be looked up per finding rather than
// included via a normal relation. Fine at this project's scale; would want a
// batched lookup before this could handle real volume.
export async function getRecentCriticalFindings(locationId: string, limit = 5): Promise<RecentFinding[]> {
  const calls = await prisma.call.findMany({
    where: { locationId },
    select: { id: true, agentId: true, agent: { select: { name: true } } },
  });
  const callIds = calls.map((c) => c.id);
  const callById = new Map(calls.map((c) => [c.id, c]));

  const failResults = await prisma.criterionResult.findMany({
    where: { verdict: "FAIL", evaluation: { callId: { in: callIds } } },
    include: { evaluation: { select: { callId: true, createdAt: true } } },
    orderBy: { evaluation: { createdAt: "desc" } },
    take: limit * 5, // over-fetch; not every FAIL is CRITICAL severity
  });

  const findings: RecentFinding[] = [];
  for (const result of failResults) {
    if (findings.length >= limit) break;
    const call = callById.get(result.evaluation.callId);
    if (!call) continue;

    const criterion = await prisma.criterion.findFirst({
      where: { key: result.criterionKey, scorecard: { agentId: call.agentId } },
      orderBy: { scorecard: { version: "desc" } },
      select: { severity: true },
    });
    if (criterion?.severity !== "CRITICAL") continue;

    findings.push({
      callId: result.evaluation.callId,
      agentName: call.agent.name,
      criterionKey: result.criterionKey,
      rationale: result.rationale,
      createdAt: result.evaluation.createdAt,
    });
  }

  return findings;
}
