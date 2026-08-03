import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAgentById } from "../../db/agents.js";
import {
  getRecommendationById,
  listRecommendations,
  markRecommendationDismissed,
} from "../../db/recommendations.js";
import { applyRecommendation } from "../../eval/applyRecommendation.js";

const listQuerySchema = z.object({
  agentId: z.string().optional(),
  status: z.enum(["OPEN", "APPLIED", "DISMISSED"]).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

export async function registerRecommendationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/recommendations", async (request, reply) => {
    const filters = listQuerySchema.parse(request.query);
    const recommendations = await listRecommendations(request.locationId, filters);
    return reply.send({ recommendations });
  });

  app.post("/api/recommendations/:id/apply", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const rec = await getRecommendationById(request.locationId, id);
    if (!rec) {
      return reply.status(404).send({ error: "Recommendation not found" });
    }
    if (rec.status !== "OPEN") {
      return reply.status(409).send({ error: `Recommendation is ${rec.status}, not OPEN` });
    }

    // getRecommendationById already confirmed rec.agentId belongs to this
    // location, but the agent record itself (ghlAgentId, etc.) is fetched the
    // same tenant-scoped way as every other agent lookup.
    const agent = await getAgentById(request.locationId, rec.agentId);
    if (!agent) {
      return reply.status(404).send({ error: "Agent not found" });
    }

    const updated = await applyRecommendation(rec, agent);
    return reply.send(updated);
  });

  app.post("/api/recommendations/:id/dismiss", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const rec = await getRecommendationById(request.locationId, id);
    if (!rec) {
      return reply.status(404).send({ error: "Recommendation not found" });
    }

    const updated = await markRecommendationDismissed(id);
    return reply.send(updated);
  });
}
