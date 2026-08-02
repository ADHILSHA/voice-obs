import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listRecommendations } from "../../db/recommendations.js";

const listQuerySchema = z.object({
  agentId: z.string().optional(),
  status: z.enum(["OPEN", "APPLIED", "DISMISSED"]).optional(),
});

export async function registerRecommendationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recommendations", async (request, reply) => {
    const filters = listQuerySchema.parse(request.query);
    const recommendations = await listRecommendations(request.locationId, filters);
    return reply.send({ recommendations });
  });
}
