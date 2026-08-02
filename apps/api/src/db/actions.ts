import type { ActionItem, ActionReason, ActionStatus } from "../../generated/prisma/client.js";
import { prisma } from "./client.js";

export interface ListActionsFilters {
  reason?: ActionReason;
  status?: ActionStatus;
}

export interface UpdateActionInput {
  status?: ActionStatus;
  assignee?: string | null;
  note?: string | null;
}

// ActionItem.callId is a plain scalar, not a Prisma relation (same reasoning as
// db/insights.ts) -- tenant scoping resolves this location's call ids first.
export async function listActions(locationId: string, filters: ListActionsFilters): Promise<ActionItem[]> {
  const calls = await prisma.call.findMany({ where: { locationId }, select: { id: true } });
  const callIds = calls.map((c) => c.id);

  return prisma.actionItem.findMany({
    where: {
      callId: { in: callIds },
      ...(filters.reason ? { reason: filters.reason } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getActionById(locationId: string, id: string): Promise<ActionItem | null> {
  const action = await prisma.actionItem.findUnique({ where: { id } });
  if (!action) return null;
  const call = await prisma.call.findFirst({ where: { id: action.callId, locationId }, select: { id: true } });
  return call ? action : null;
}

export async function updateAction(id: string, input: UpdateActionInput): Promise<ActionItem> {
  return prisma.actionItem.update({ where: { id }, data: input });
}
