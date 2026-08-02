import type { FastifyInstance } from "fastify";
import type { Prisma } from "../../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../db/client.js";
import { enqueueIngestCall } from "../../jobs/queue.js";

// The exact webhook payload shape is unconfirmed (BUILD_SPEC §2). Extraction is
// deliberately tolerant of several plausible field names rather than assuming one.
function findLocationId(payload: Record<string, unknown>): string {
  for (const key of ["locationId", "location_id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  // Single-sandbox fallback -- this project doesn't support multi-tenant (non-goal).
  return env.GHL_LOCATION_ID;
}

function findCallId(payload: Record<string, unknown>): string | null {
  for (const key of ["callId", "call_id", "id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/webhooks/ghl/voice-ai", async (request, reply) => {
    const secret = request.headers["x-webhook-secret"];
    if (secret !== env.GHL_WEBHOOK_SECRET) {
      return reply.status(401).send({ error: "Invalid webhook secret" });
    }

    const payload = (request.body ?? {}) as Record<string, unknown>;
    const locationId = findLocationId(payload);

    // Logged durably before responding -- this is the audit trail BUILD_SPEC §6.2
    // wants for replay, so it has to survive even if the process dies right after
    // responding. The enqueue step below is what actually gets deferred to stay
    // under the 100ms budget.
    const event = await prisma.webhookEvent.create({
      data: { locationId, payload: payload as Prisma.InputJsonValue },
    });

    const callId = findCallId(payload);
    if (callId) {
      void enqueueIngestCall(locationId, callId)
        .then(() => prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } }))
        .catch((err: unknown) => {
          request.log.error({ webhookEventId: event.id, err }, "failed to enqueue ingest-call from webhook");
        });
    } else {
      request.log.warn({ webhookEventId: event.id }, "webhook payload had no recognizable call id, skipped enqueue");
    }

    return reply.status(200).send({ received: true });
  });
}
