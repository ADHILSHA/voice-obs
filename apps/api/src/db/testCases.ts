import type { Prisma, TestCase, TestCaseStatus } from "../../generated/prisma/client.js";
import { prisma } from "./client.js";

export interface CreateTestCaseInput {
  agentId: string;
  key: string;
  title: string;
  scenario: string;
  expectedResult: string;
  transcript: Prisma.InputJsonValue;
}

export async function createTestCase(data: CreateTestCaseInput): Promise<TestCase> {
  return prisma.testCase.create({ data: { ...data, status: "NOT_TESTED" } });
}

export interface ListTestCasesFilters {
  agentId?: string;
  status?: TestCaseStatus;
}

// TestCase.agentId is a plain scalar, not a Prisma relation (same reasoning as
// Recommendation.agentId) -- tenant scoping resolves this location's agent ids first.
export async function listTestCases(locationId: string, filters: ListTestCasesFilters): Promise<TestCase[]> {
  const agents = await prisma.agent.findMany({ where: { locationId }, select: { id: true } });
  const agentIds = agents.map((a) => a.id);

  return prisma.testCase.findMany({
    where: {
      agentId: filters.agentId ?? { in: agentIds },
      ...(filters.status ? { status: filters.status } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

// Resolves a test case scoped to a location the same way calls/actions are
// scoped elsewhere: through the owning agent's locationId, since TestCase has
// no locationId column of its own.
export async function getTestCaseById(locationId: string, id: string): Promise<TestCase | null> {
  const testCase = await prisma.testCase.findUnique({ where: { id } });
  if (!testCase) return null;
  const agent = await prisma.agent.findFirst({ where: { id: testCase.agentId, locationId }, select: { id: true } });
  return agent ? testCase : null;
}

export interface UpdateTestCaseInput {
  status?: TestCaseStatus;
  note?: string | null;
}

export async function updateTestCase(id: string, input: UpdateTestCaseInput): Promise<TestCase> {
  return prisma.testCase.update({ where: { id }, data: input });
}

export interface ExistingTestCaseKey {
  key: string;
  title: string;
}

// Every key that already has a TestCase row for this agent is skipped on
// regenerate -- a human may already be tracking a status against that key, so
// it must never be silently duplicated.
export async function getExistingTestCaseKeys(agentId: string): Promise<ExistingTestCaseKey[]> {
  return prisma.testCase.findMany({ where: { agentId }, select: { key: true, title: true } });
}
