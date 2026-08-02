import type { FastifyInstance } from "fastify";
import { getOverviewStats, getRecentCriticalFindings } from "../../db/insights.js";

export async function registerInsightsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/insights/overview", async (request, reply) => {
    const [stats, needsAttention] = await Promise.all([
      getOverviewStats(request.locationId),
      getRecentCriticalFindings(request.locationId),
    ]);
    return reply.send({ ...stats, needsAttention });
  });
}
