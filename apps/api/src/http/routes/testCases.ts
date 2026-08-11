import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getTestCaseById, listTestCases, updateTestCase } from "../../db/testCases.js";

const listQuerySchema = z.object({
  agentId: z.string().optional(),
  status: z.enum(["NOT_TESTED", "PASSED", "FAILED"]).optional(),
});

const idParamsSchema = z.object({ id: z.string().min(1) });

const patchSchema = z.object({
  status: z.enum(["NOT_TESTED", "PASSED", "FAILED"]).optional(),
  note: z.string().nullable().optional(),
});

export async function registerTestCaseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/test-cases", async (request, reply) => {
    const filters = listQuerySchema.parse(request.query);
    const testCases = await listTestCases(request.locationId, filters);
    return reply.send({ testCases });
  });

  app.patch("/api/test-cases/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const existing = await getTestCaseById(request.locationId, id);
    if (!existing) {
      return reply.status(404).send({ error: "Test case not found" });
    }

    const patch = patchSchema.parse(request.body);
    const updated = await updateTestCase(id, patch);
    return reply.send(updated);
  });
}
