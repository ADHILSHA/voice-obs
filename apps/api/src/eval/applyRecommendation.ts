import { z } from "zod";
import type { Agent, Recommendation } from "../../generated/prisma/client.js";
import { updateAgentPromptSnapshot } from "../db/agents.js";
import { computePassRate } from "../db/scorecards.js";
import { prisma } from "../db/client.js";
import { markRecommendationApplied } from "../db/recommendations.js";
import { getAgent, updateAgentPrompt } from "../ghl/client.js";
import { resolveAccessToken } from "../ghl/tokens.js";

const promptDiffSchema = z.object({
  before: z.string(),
  after: z.string(),
  insertAfterLine: z.number().int().positive().optional(),
});

// Pure and unit-testable on its own: given the live prompt text and a diff,
// returns the new prompt. Never silently no-ops -- if `before` no longer
// matches (the prompt changed since this recommendation was synthesized) or
// insertAfterLine is out of range, it throws rather than guessing.
export function applyPromptDiff(promptDiff: z.infer<typeof promptDiffSchema>, currentPrompt: string): string {
  if (promptDiff.before !== "") {
    if (!currentPrompt.includes(promptDiff.before)) {
      throw new Error(
        "promptDiff.before no longer matches the live agent prompt -- it may have changed since this recommendation was generated",
      );
    }
    return currentPrompt.replace(promptDiff.before, promptDiff.after);
  }

  if (promptDiff.insertAfterLine === undefined) {
    throw new Error("promptDiff has empty before text and no insertAfterLine -- cannot apply");
  }
  const lines = currentPrompt.split("\n");
  if (promptDiff.insertAfterLine > lines.length) {
    throw new Error(
      `promptDiff.insertAfterLine (${promptDiff.insertAfterLine}) is out of range for a prompt with ${lines.length} lines`,
    );
  }
  lines.splice(promptDiff.insertAfterLine, 0, promptDiff.after);
  return lines.join("\n");
}

async function computeBaselineRate(agentId: string, criterionKey: string): Promise<number | null> {
  const results = await prisma.criterionResult.findMany({
    where: { criterionKey, evaluation: { call: { agentId } } },
    select: { verdict: true },
  });
  return computePassRate(results);
}

// Caller (the route) is responsible for the tenant-scoped existence check --
// this assumes `rec` and `agent` are already verified to belong to the request's
// locationId, same division of responsibility as calls.ts's reevaluate route.
export async function applyRecommendation(rec: Recommendation, agent: Agent): Promise<Recommendation> {
  const promptDiff = promptDiffSchema.parse(rec.promptDiff);

  // Re-fetches the live prompt rather than trusting agent.promptSnapshot, which
  // may be stale if the agent was edited in HighLevel since our last ingest.
  const token = await resolveAccessToken(agent.locationId);
  const liveAgent = await getAgent(token, agent.locationId, agent.ghlAgentId);
  const newPrompt = applyPromptDiff(promptDiff, liveAgent.agentPrompt);

  const baselineRate = await computeBaselineRate(rec.agentId, rec.criterionKey);

  const updated = await updateAgentPrompt(token, agent.locationId, agent.ghlAgentId, newPrompt);
  await updateAgentPromptSnapshot(agent.id, updated.agentPrompt);

  return markRecommendationApplied(rec.id, baselineRate);
}
