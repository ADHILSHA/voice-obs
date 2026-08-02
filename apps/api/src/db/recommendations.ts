import type { Recommendation, RecStatus } from "../../generated/prisma/client.js";
import { prisma } from "./client.js";

export interface ListRecommendationsFilters {
  agentId?: string;
  status?: RecStatus;
}

// Recommendation.agentId is a plain scalar, not a Prisma relation (same
// reasoning as db/insights.ts) -- tenant scoping resolves this location's agent
// ids first. Nothing creates Recommendation rows yet (Phase 6 clustering) --
// this always reads a real, currently-empty table, not a stub.
export async function listRecommendations(
  locationId: string,
  filters: ListRecommendationsFilters,
): Promise<Recommendation[]> {
  const agents = await prisma.agent.findMany({ where: { locationId }, select: { id: true } });
  const agentIds = agents.map((a) => a.id);

  return prisma.recommendation.findMany({
    where: {
      agentId: filters.agentId ?? { in: agentIds },
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}
