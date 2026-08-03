import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CriterionCategory, ScorecardSource, Severity } from "../../../generated/prisma/client.js";
import { getAgentById, listAgentsByLocation } from "../../db/agents.js";
import { countCallsForAgent } from "../../db/calls.js";
import { getHealthScoresForAgent } from "../../db/evaluations.js";
import {
  createScorecardVersion,
  getActiveScorecard,
  getCriterionStats,
  type CriterionInput,
  type CriterionStat,
} from "../../db/scorecards.js";
import { generateScorecardCriteria, type GeneratedCriterion } from "../../eval/generateScorecard.js";
import { generateRecommendationsForAgent } from "../../eval/generateRecommendations.js";
import { computeAgentHealthScore, computeDailySparkline } from "../../eval/healthScore.js";

function topFailingCriterion(stats: CriterionStat[]): CriterionStat | null {
  const withFailures = stats.filter((s) => s.failingCallCount > 0);
  if (withFailures.length === 0) return null;
  return withFailures.reduce((worst, s) => (s.failingCallCount > worst.failingCallCount ? s : worst));
}

const CATEGORY_MAP: Record<GeneratedCriterion["category"], CriterionCategory> = {
  goal: CriterionCategory.GOAL,
  data_capture: CriterionCategory.DATA_CAPTURE,
  knowledge: CriterionCategory.KNOWLEDGE,
  containment: CriterionCategory.CONTAINMENT,
  compliance: CriterionCategory.COMPLIANCE,
  conversational: CriterionCategory.CONVERSATIONAL,
};

const SEVERITY_MAP: Record<GeneratedCriterion["severity"], Severity> = {
  low: Severity.LOW,
  medium: Severity.MEDIUM,
  high: Severity.HIGH,
  critical: Severity.CRITICAL,
};

function toCriterionInput(generated: GeneratedCriterion): CriterionInput {
  return {
    key: generated.key,
    name: generated.name,
    description: generated.description,
    category: CATEGORY_MAP[generated.category],
    severity: SEVERITY_MAP[generated.severity],
    weight: generated.weight,
    method: "LLM",
  };
}

const idParamsSchema = z.object({ id: z.string().min(1) });

const criterionInputSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, "must be snake_case"),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(["GOAL", "DATA_CAPTURE", "KNOWLEDGE", "CONTAINMENT", "COMPLIANCE", "CONVERSATIONAL"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  weight: z.number().positive().default(1),
  method: z.enum(["DETERMINISTIC", "LLM"]).default("LLM"),
  deterministicRule: z.unknown().optional(),
});

const putScorecardSchema = z.object({
  criteria: z.array(criterionInputSchema).min(1),
});

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agents", async (request, reply) => {
    const agents = await listAgentsByLocation(request.locationId);
    // Real healthScore/sparkline/topFailingCriterion now that Evaluation rows
    // exist (Phase 4) -- null/empty only when there's genuinely no data yet
    // (BUILD_SPEC §7: "estimates are labelled," which cuts the other way too:
    // don't invent a number where there is none).
    const withStats = await Promise.all(
      agents.map(async (agent) => {
        const [samples, stats, callCount] = await Promise.all([
          getHealthScoresForAgent(agent.id),
          getCriterionStats(agent.id),
          countCallsForAgent(agent.id),
        ]);
        return {
          id: agent.id,
          name: agent.name,
          healthScore: computeAgentHealthScore(samples),
          sparkline: computeDailySparkline(samples),
          topFailingCriterion: topFailingCriterion(stats),
          callCount,
        };
      }),
    );
    return reply.send({ agents: withStats });
  });

  app.get("/api/agents/:id", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const agent = await getAgentById(request.locationId, id);
    if (!agent) {
      return reply.status(404).send({ error: "Agent not found" });
    }
    const [samples, criterionStats, callCount] = await Promise.all([
      getHealthScoresForAgent(agent.id),
      getCriterionStats(agent.id),
      countCallsForAgent(agent.id),
    ]);
    return reply.send({
      ...agent,
      healthScore: computeAgentHealthScore(samples),
      sparkline: computeDailySparkline(samples),
      callCount,
      criterionStats,
    });
  });

  app.post("/api/agents/:id/scorecard/generate", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const agent = await getAgentById(request.locationId, id);
    if (!agent) {
      return reply.status(404).send({ error: "Agent not found" });
    }

    const generated = await generateScorecardCriteria(agent.promptSnapshot);
    const scorecard = await createScorecardVersion(
      agent.id,
      generated.map(toCriterionInput),
      ScorecardSource.GENERATED,
    );
    return reply.send(scorecard);
  });

  app.get("/api/agents/:id/scorecard", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const agent = await getAgentById(request.locationId, id);
    if (!agent) {
      return reply.status(404).send({ error: "Agent not found" });
    }

    const scorecard = await getActiveScorecard(agent.id);
    if (!scorecard) {
      return reply.status(404).send({ error: "No scorecard generated for this agent yet" });
    }
    return reply.send(scorecard);
  });

  app.put("/api/agents/:id/scorecard", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const agent = await getAgentById(request.locationId, id);
    if (!agent) {
      return reply.status(404).send({ error: "Agent not found" });
    }

    const { criteria } = putScorecardSchema.parse(request.body);
    const scorecard = await createScorecardVersion(
      agent.id,
      criteria as CriterionInput[],
      ScorecardSource.MANUAL,
    );
    return reply.send(scorecard);
  });

  app.post("/api/agents/:id/recommendations/generate", async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const agent = await getAgentById(request.locationId, id);
    if (!agent) {
      return reply.status(404).send({ error: "Agent not found" });
    }

    const created = await generateRecommendationsForAgent(agent.id, agent.promptSnapshot);
    return reply.send({ recommendations: created });
  });
}
