import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getInstallationByLocationId } from "../../db/installations.js";
import { enqueueBackfill } from "../../jobs/queue.js";
import { getBackfillStatus } from "../../jobs/backfillJob.js";

const backfillRequestSchema = z.object({
  days: z.number().int().positive(),
});

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/sync/backfill", async (request, reply) => {
    const { days } = backfillRequestSchema.parse(request.body);
    const job = await enqueueBackfill(request.locationId, days);
    return reply.send({ jobId: job.id });
  });

  app.get("/api/sync/status", async (request, reply) => {
    const [status, installation] = await Promise.all([
      getBackfillStatus(request.locationId),
      getInstallationByLocationId(request.locationId),
    ]);

    return reply.send({
      state: status?.state ?? "idle",
      processed: status?.processed ?? 0,
      total: status?.total ?? 0,
      lastSyncedAt: installation?.lastSyncedAt ?? null,
      error: status?.error ?? null,
    });
  });
}
