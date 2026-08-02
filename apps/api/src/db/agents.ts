import type { Agent } from "../../generated/prisma/client.js";
import type { GhlAgent } from "../ghl/client.js";
import { prisma } from "./client.js";

export async function upsertAgentFromGhl(locationId: string, ghlAgent: GhlAgent): Promise<Agent> {
  return prisma.agent.upsert({
    where: { locationId_ghlAgentId: { locationId, ghlAgentId: ghlAgent.id } },
    create: {
      locationId,
      ghlAgentId: ghlAgent.id,
      name: ghlAgent.agentName,
      promptSnapshot: ghlAgent.agentPrompt,
      promptFetchedAt: new Date(),
    },
    update: {
      name: ghlAgent.agentName,
      promptSnapshot: ghlAgent.agentPrompt,
      promptFetchedAt: new Date(),
    },
  });
}

export async function getAgentByGhlId(locationId: string, ghlAgentId: string): Promise<Agent | null> {
  return prisma.agent.findUnique({ where: { locationId_ghlAgentId: { locationId, ghlAgentId } } });
}
