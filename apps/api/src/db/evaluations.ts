import type { Prisma, RootCause, Verdict } from "../../generated/prisma/client.js";
import { prisma } from "./client.js";

export interface CriterionResultInput {
  criterionKey: string;
  verdict: Verdict;
  confidence: number;
  evidenceTurns: number[];
  rationale: string;
  rootCause?: RootCause;
}

export interface CreateEvaluationInput {
  callId: string;
  scorecardVersion: number;
  promptVersion: string;
  inputHash: string;
  healthScore: number;
  metrics: Prisma.InputJsonValue;
  results: CriterionResultInput[];
}

export type EvaluationWithResults = Prisma.EvaluationGetPayload<{ include: { results: true } }>;

export async function createEvaluation(input: CreateEvaluationInput): Promise<EvaluationWithResults> {
  const { results, ...evaluationFields } = input;
  return prisma.evaluation.create({
    data: { ...evaluationFields, results: { create: results } },
    include: { results: true },
  });
}

export async function findByInputHash(
  callId: string,
  inputHash: string,
): Promise<EvaluationWithResults | null> {
  return prisma.evaluation.findUnique({
    where: { callId_inputHash: { callId, inputHash } },
    include: { results: true },
  });
}

export interface HealthScoreRow {
  healthScore: number;
  createdAt: Date;
}

// Unfiltered by date -- the rolling-window business rule lives in
// eval/healthScore.ts, not split across the db layer too.
export async function getHealthScoresForAgent(agentId: string): Promise<HealthScoreRow[]> {
  return prisma.evaluation.findMany({
    where: { call: { agentId } },
    select: { healthScore: true, createdAt: true },
  });
}

// No onDelete: Cascade on CriterionResult.evaluation, so results have to go
// first. Used by POST /api/calls/:id/reevaluate to clear the cache before
// re-running evaluateCall -- deliberately not just deleting by inputHash, since
// the point is to force a fresh judge call regardless of whether the input
// happens to hash the same as before.
export async function deleteEvaluationsForCall(callId: string): Promise<void> {
  await prisma.$transaction([
    prisma.criterionResult.deleteMany({ where: { evaluation: { callId } } }),
    prisma.evaluation.deleteMany({ where: { callId } }),
  ]);
}
