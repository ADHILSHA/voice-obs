import { Prisma } from "../../generated/prisma/client.js";
import type { Call, RootCause, TurnRole, Verdict } from "../../generated/prisma/client.js";
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

export async function countCallsForAgent(agentId: string): Promise<number> {
  return prisma.call.count({ where: { agentId } });
}

export async function callExists(locationId: string, ghlCallId: string): Promise<boolean> {
  const call = await prisma.call.findUnique({
    where: { locationId_ghlCallId: { locationId, ghlCallId } },
    select: { id: true },
  });
  return call !== null;
}

export interface ListCallsFilters {
  agentId?: string;
  verdict?: Verdict;
  criterionKey?: string;
  rootCause?: string;
  from?: Date;
  to?: Date;
  page?: number;
}

const CALLS_PAGE_SIZE = 20;

// Uses `select`, not `include`, so list rows stay light -- `include` would pull
// every scalar column (rawPayload's full duplicated transcript, agent's full
// promptSnapshot) onto every row in what's meant to be a summary view.
const callListSelect = {
  id: true,
  locationId: true,
  agentId: true,
  ghlCallId: true,
  startedAt: true,
  durationSec: true,
  direction: true,
  endedReason: true,
  recordingUrl: true,
  isTrialCall: true,
  agent: { select: { id: true, name: true } },
  evaluations: {
    select: { id: true, callId: true, scorecardVersion: true, healthScore: true, metrics: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.CallSelect;

export type CallListItem = Prisma.CallGetPayload<{ select: typeof callListSelect }>;

export interface ListCallsResult {
  calls: CallListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listCalls(locationId: string, filters: ListCallsFilters): Promise<ListCallsResult> {
  const page = filters.page ?? 1;

  const dateFilter: Prisma.DateTimeFilter = {};
  if (filters.from) dateFilter.gte = filters.from;
  if (filters.to) dateFilter.lte = filters.to;

  const where: Prisma.CallWhereInput = {
    locationId,
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.from || filters.to ? { startedAt: dateFilter } : {}),
    ...(filters.verdict || filters.criterionKey || filters.rootCause
      ? {
          evaluations: {
            some: {
              results: {
                some: {
                  ...(filters.criterionKey ? { criterionKey: filters.criterionKey } : {}),
                  ...(filters.verdict ? { verdict: filters.verdict } : {}),
                  ...(filters.rootCause ? { rootCause: filters.rootCause as RootCause } : {}),
                },
              },
            },
          },
        }
      : {}),
  };

  const [calls, total] = await Promise.all([
    prisma.call.findMany({
      where,
      select: callListSelect,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * CALLS_PAGE_SIZE,
      take: CALLS_PAGE_SIZE,
    }),
    prisma.call.count({ where }),
  ]);

  return { calls, page, pageSize: CALLS_PAGE_SIZE, total };
}

export type CallWithDetails = Prisma.CallGetPayload<{
  include: { turns: true; agent: true; evaluations: { include: { results: true } } };
}>;

// Scoped by locationId for tenant isolation, not just id -- a session for
// location A must never be able to read location B's call by guessing an id.
export async function getCallWithDetails(locationId: string, id: string): Promise<CallWithDetails | null> {
  return prisma.call.findFirst({
    where: { id, locationId },
    include: {
      turns: { orderBy: { idx: "asc" } },
      agent: true,
      evaluations: { include: { results: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}
