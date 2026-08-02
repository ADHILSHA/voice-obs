import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { getCallWithDetails, listCalls } from "../../db/calls.js";
import { deleteEvaluationsForCall } from "../../db/evaluations.js";
import { evaluateCall } from "../../eval/evaluateCall.js";
import { decryptToken } from "../../lib/crypto.js";

const idParamsSchema = z.object({ id: z.string().min(1) });

const listQuerySchema = z.object({
  agentId: z.string().optional(),
  verdict: z.enum(["PASS", "PARTIAL", "FAIL", "NOT_APPLICABLE"]).optional(),
  criterionKey: z.string().optional(),
  rootCause: z
    .enum([
      "MISSING_INSTRUCTION",
      "AMBIGUOUS_INSTRUCTION",
      "KNOWLEDGE_GAP",
      "FLOW_ORDERING",
      "GUARDRAIL_MISSING",
      "CALLER_SIDE",
    ])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
});

export async function registerCallRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/calls", async (request, reply) => {
    const filters = listQuerySchema.parse(request.query);
    const result = await listCalls(request.locationId, filters);
    return reply.send(result);
  });

  app.get("/api/calls/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const call = await getCallWithDetails(request.locationId, id);
    if (!call) {
      return reply.status(404).send({ error: "Call not found" });
    }
    return reply.send(call);
  });

  app.post("/api/calls/:id/reevaluate", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const call = await getCallWithDetails(request.locationId, id);
    if (!call) {
      return reply.status(404).send({ error: "Call not found" });
    }

    // Deliberately clears the cache rather than relying on inputHash matching --
    // the point of a manual reevaluate is to force a fresh judge call regardless.
    await deleteEvaluationsForCall(id);
    await evaluateCall(id);

    const updated = await getCallWithDetails(request.locationId, id);
    return reply.send(updated);
  });

  app.post("/api/calls/:id/reveal", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const call = await getCallWithDetails(request.locationId, id);
    if (!call) {
      return reply.status(404).send({ error: "Call not found" });
    }
    if (!call.redactionMap) {
      return reply.send({ mapping: {} });
    }

    const mapping = JSON.parse(decryptToken(call.redactionMap, env.TOKEN_ENCRYPTION_KEY)) as Record<
      string,
      string
    >;
    return reply.send({ mapping });
  });
}
