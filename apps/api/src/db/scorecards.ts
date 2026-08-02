import type {
  CriterionCategory,
  EvalMethod,
  Prisma,
  Scorecard,
  ScorecardSource,
  Severity,
} from "../../generated/prisma/client.js";
import { prisma } from "./client.js";

export interface CriterionInput {
  key: string;
  name: string;
  description: string;
  category: CriterionCategory;
  severity: Severity;
  weight: number;
  method: EvalMethod;
  deterministicRule?: Prisma.InputJsonValue;
}

export type ScorecardWithCriteria = Prisma.ScorecardGetPayload<{ include: { criteria: true } }>;

// Creates the next version for an agent's scorecard and deactivates the previous
// one, in one transaction. Old Criterion rows are never touched, so existing
// CriterionResult/Evaluation history stays intact -- this is what "editing and
// saving creates version 2 without breaking version 1's stored results" requires.
export async function createScorecardVersion(
  agentId: string,
  criteria: CriterionInput[],
  source: ScorecardSource,
): Promise<ScorecardWithCriteria> {
  return prisma.$transaction(async (tx) => {
    const previousActive = await tx.scorecard.findFirst({
      where: { agentId, isActive: true },
      orderBy: { version: "desc" },
    });

    if (previousActive) {
      await tx.scorecard.update({ where: { id: previousActive.id }, data: { isActive: false } });
    }

    return tx.scorecard.create({
      data: {
        agentId,
        version: (previousActive?.version ?? 0) + 1,
        isActive: true,
        source,
        criteria: { create: criteria },
      },
      include: { criteria: true },
    });
  });
}

export async function getActiveScorecard(agentId: string): Promise<ScorecardWithCriteria | null> {
  return prisma.scorecard.findFirst({
    where: { agentId, isActive: true },
    include: { criteria: true },
    orderBy: { version: "desc" },
  });
}

export async function getScorecardVersion(
  agentId: string,
  version: number,
): Promise<ScorecardWithCriteria | null> {
  return prisma.scorecard.findUnique({
    where: { agentId_version: { agentId, version } },
    include: { criteria: true },
  });
}

export async function listScorecardVersions(agentId: string): Promise<Scorecard[]> {
  return prisma.scorecard.findMany({ where: { agentId }, orderBy: { version: "desc" } });
}
