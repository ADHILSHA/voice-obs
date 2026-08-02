import type { Prisma } from "../../generated/prisma/client.js";
import { env } from "../config/env.js";
import { getAgentByGhlId, upsertAgentFromGhl } from "../db/agents.js";
import { upsertCall } from "../db/calls.js";
import { getAgent, getCallLog } from "../ghl/client.js";
import { resolveAccessToken } from "../ghl/tokens.js";
import { enqueueEvaluateCall } from "../jobs/queue.js";
import { encryptToken } from "../lib/crypto.js";
import { createRedactionState, redactDeep, redactText } from "../lib/redaction.js";
import { normalizeCall } from "./normalizer.js";

// The shared destination for all three ingestion entry points (backfill, webhook,
// delta poller) -- nothing else touches Call/Turn rows directly.
export async function ingestCall(locationId: string, ghlCallId: string): Promise<void> {
  const token = await resolveAccessToken(locationId);
  const raw = await getCallLog(token, locationId, ghlCallId);

  let agent = await getAgentByGhlId(locationId, raw.agentId);
  if (!agent) {
    const ghlAgent = await getAgent(token, locationId, raw.agentId);
    agent = await upsertAgentFromGhl(locationId, ghlAgent);
  }

  const { call, turns } = normalizeCall(raw, locationId);

  // One redaction state shared across turns, summary, extractedData and the raw
  // payload so the same real value gets the same placeholder everywhere it shows
  // up in this call's data (lib/redaction.ts).
  const redaction = createRedactionState();
  const redactedTurns = turns.map((turn) => ({ ...turn, text: redactText(turn.text, redaction) }));
  const redactedSummary = call.summary ? redactText(call.summary, redaction) : null;
  const redactedExtractedData = call.extractedData
    ? (redactDeep(call.extractedData, redaction) as Record<string, unknown>)
    : null;
  const redactedRawPayload = redactDeep(raw, redaction);

  const redactionMap =
    Object.keys(redaction.mapping).length > 0
      ? encryptToken(JSON.stringify(redaction.mapping), env.TOKEN_ENCRYPTION_KEY)
      : null;

  const savedCall = await upsertCall({
    locationId,
    agentId: agent.id,
    ghlCallId: call.ghlCallId,
    startedAt: call.startedAt,
    durationSec: call.durationSec,
    direction: call.direction,
    endedReason: call.endedReason,
    actionsTriggered: call.actionsTriggered as Prisma.InputJsonValue,
    recordingUrl: call.recordingUrl,
    contactRef: call.contactRef,
    summary: redactedSummary,
    extractedData: redactedExtractedData as Prisma.InputJsonValue | null,
    isTrialCall: call.isTrialCall,
    isAgentDeleted: call.isAgentDeleted,
    translation: call.translation as Prisma.InputJsonValue | null,
    rawPayload: redactedRawPayload as Prisma.InputJsonValue,
    redactionMap,
    turns: redactedTurns,
  });

  // §6.2: ingestion "upserts, then enqueues evaluation jobs." One shared place
  // to enqueue from, since this function is already the single destination for
  // all three ingestion entry points.
  await enqueueEvaluateCall(savedCall.id);
}
