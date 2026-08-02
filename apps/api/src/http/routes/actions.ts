import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getActionById, listActions, updateAction } from "../../db/actions.js";

const listQuerySchema = z.object({
  reason: z.enum(["HUMAN_REQUESTED", "HIGH_INTENT_LOST", "COMPLIANCE_MISS", "KNOWLEDGE_GAP"]).optional(),
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"]).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const patchSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"]).optional(),
  assignee: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function registerActionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/actions", async (request, reply) => {
    const filters = listQuerySchema.parse(request.query);
    const actions = await listActions(request.locationId, filters);
    return reply.send({ actions });
  });

  app.patch("/api/actions/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const existing = await getActionById(request.locationId, id);
    if (!existing) {
      return reply.status(404).send({ error: "Action not found" });
    }

    const patch = patchSchema.parse(request.body);
    const updated = await updateAction(id, patch);
    return reply.send(updated);
  });
}
