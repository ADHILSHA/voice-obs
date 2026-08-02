import type { Agent, Prisma } from "../../generated/prisma/client.js";
import type { GhlAgent } from "../ghl/client.js";
import { prisma } from "./client.js";

export async function upsertAgentFromGhl(locationId: string, ghlAgent: GhlAgent): Promise<Agent> {
  const actions = ghlAgent.actions as Prisma.InputJsonValue;
  return prisma.agent.upsert({
    where: { locationId_ghlAgentId: { locationId, ghlAgentId: ghlAgent.id } },
    create: {
      locationId,
      ghlAgentId: ghlAgent.id,
      name: ghlAgent.agentName,
      promptSnapshot: ghlAgent.agentPrompt,
      promptFetchedAt: new Date(),
      actions,
    },
    update: {
      name: ghlAgent.agentName,
      promptSnapshot: ghlAgent.agentPrompt,
      promptFetchedAt: new Date(),
      actions,
    },
  });
}

export async function getAgentByGhlId(locationId: string, ghlAgentId: string): Promise<Agent | null> {
  return prisma.agent.findUnique({ where: { locationId_ghlAgentId: { locationId, ghlAgentId } } });
}

export async function listAgentsByLocation(locationId: string): Promise<Agent[]> {
  return prisma.agent.findMany({ where: { locationId }, orderBy: { name: "asc" } });
}

// Internal cuid lookup, scoped to locationId for tenant isolation -- distinct from
// getAgentByGhlId, which is ingestion-only and keyed on the GHL id.
export async function getAgentById(locationId: string, id: string): Promise<Agent | null> {
  return prisma.agent.findFirst({ where: { id, locationId } });
}
