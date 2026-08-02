import { Prisma } from "../../generated/prisma/client.js";
import type { Call, TurnRole } from "../../generated/prisma/client.js";
import { prisma } from "./client.js";

export interface UpsertCallInput {
  locationId: string;
  agentId: string;
  ghlCallId: string;
  startedAt: Date;
  durationSec: number;
  direction: string | null;
  endedReason: string | null;
  actionsTriggered: Prisma.InputJsonValue;
  recordingUrl: string | null;
  contactRef: string | null;
  summary: string | null;
  extractedData: Prisma.InputJsonValue | null;
  isTrialCall: boolean;
  isAgentDeleted: boolean;
  translation: Prisma.InputJsonValue | null;
  rawPayload: Prisma.InputJsonValue;
  redactionMap: string | null;
  turns: { idx: number; role: TurnRole; text: string; startMs: number | null }[];
}

// Upsert on (locationId, ghlCallId) per BUILD_SPEC §6.2's idempotency requirement.
// Turns are replaced wholesale (delete + recreate) on every upsert rather than
// diffed, so re-ingesting a call never duplicates or orphans Turn rows.
export async function upsertCall(input: UpsertCallInput): Promise<Call> {
  const { turns, extractedData, translation, ...rest } = input;
  const callFields = {
    ...rest,
    extractedData: extractedData ?? Prisma.JsonNull,
    translation: translation ?? Prisma.JsonNull,
  };

  return prisma.$transaction(async (tx) => {
    const call = await tx.call.upsert({
      where: {
        locationId_ghlCallId: { locationId: callFields.locationId, ghlCallId: callFields.ghlCallId },
      },
      create: callFields,
      update: callFields,
    });

    await tx.turn.deleteMany({ where: { callId: call.id } });
    await tx.turn.createMany({
      data: turns.map((turn) => ({ ...turn, callId: call.id })),
    });

    return call;
  });
}

export async function callExists(locationId: string, ghlCallId: string): Promise<boolean> {
  const call = await prisma.call.findUnique({
    where: { locationId_ghlCallId: { locationId, ghlCallId } },
    select: { id: true },
  });
  return call !== null;
}
