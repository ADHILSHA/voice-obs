import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import {
  createTestCase,
  getExistingTestCaseKeys,
  getTestCaseById,
  listTestCases,
  updateTestCase,
} from "../../src/db/testCases.js";

const LOCATION_ID = "loc-test-testcases";
const OTHER_LOCATION_ID = "loc-test-testcases-other";

const TRANSCRIPT = [
  { role: "AGENT", text: "Hi, thanks for calling!" },
  { role: "CALLER", text: "I'd like to book an appointment." },
];

let agentId: string;

async function cleanup(): Promise<void> {
  // TestCase.agentId is a plain scalar, not a Prisma relation (same as
  // production code) -- resolve agent ids first rather than nesting a filter
  // Prisma can't express.
  const agents = await prisma.agent.findMany({
    where: { locationId: { in: [LOCATION_ID, OTHER_LOCATION_ID] } },
    select: { id: true },
  });
  const agentIds = agents.map((a) => a.id);

  await prisma.testCase.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agent.deleteMany({ where: { locationId: { in: [LOCATION_ID, OTHER_LOCATION_ID] } } });
}

describe("db/testCases", () => {
  beforeEach(async () => {
    await cleanup();
    const agent = await prisma.agent.create({
      data: {
        locationId: LOCATION_ID,
        ghlAgentId: "ghl-agent-testcase-test",
        name: "Test Agent",
        promptSnapshot: "You are a test agent.",
        promptFetchedAt: new Date(),
      },
    });
    agentId = agent.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates a test case defaulted to NOT_TESTED", async () => {
    const created = await createTestCase({
      agentId,
      key: "clean_booking",
      title: "Clean booking success",
      scenario: "Caller books a normal appointment.",
      expectedResult: "Agent confirms name, phone, and a specific time.",
      transcript: TRANSCRIPT,
    });

    expect(created.status).toBe("NOT_TESTED");
    expect(created.note).toBeNull();
    expect(created.transcript).toEqual(TRANSCRIPT);
  });

  it("lists test cases scoped to the location, filterable by agentId and status", async () => {
    await createTestCase({
      agentId,
      key: "clean_booking",
      title: "Clean booking success",
      scenario: "s",
      expectedResult: "e",
      transcript: TRANSCRIPT,
    });
    const failing = await createTestCase({
      agentId,
      key: "pricing_question",
      title: "Pricing question",
      scenario: "s",
      expectedResult: "e",
      transcript: TRANSCRIPT,
    });
    await updateTestCase(failing.id, { status: "FAILED" });

    const all = await listTestCases(LOCATION_ID, {});
    expect(all).toHaveLength(2);

    const byAgent = await listTestCases(LOCATION_ID, { agentId });
    expect(byAgent).toHaveLength(2);

    const byStatus = await listTestCases(LOCATION_ID, { status: "FAILED" });
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0].key).toBe("pricing_question");
  });

  it("does not list test cases belonging to a different location", async () => {
    const otherAgent = await prisma.agent.create({
      data: {
        locationId: OTHER_LOCATION_ID,
        ghlAgentId: "ghl-agent-testcase-other",
        name: "Other Agent",
        promptSnapshot: "You are another agent.",
        promptFetchedAt: new Date(),
      },
    });
    await createTestCase({
      agentId: otherAgent.id,
      key: "other_case",
      title: "Other",
      scenario: "s",
      expectedResult: "e",
      transcript: TRANSCRIPT,
    });

    const list = await listTestCases(LOCATION_ID, {});
    expect(list).toHaveLength(0);
  });

  it("updates status and note", async () => {
    const created = await createTestCase({
      agentId,
      key: "clean_booking",
      title: "Clean booking success",
      scenario: "s",
      expectedResult: "e",
      transcript: TRANSCRIPT,
    });

    const updated = await updateTestCase(created.id, { status: "PASSED", note: "Worked as expected." });
    expect(updated.status).toBe("PASSED");
    expect(updated.note).toBe("Worked as expected.");
  });

  it("returns existing keys and titles for an agent", async () => {
    await createTestCase({
      agentId,
      key: "clean_booking",
      title: "Clean booking success",
      scenario: "s",
      expectedResult: "e",
      transcript: TRANSCRIPT,
    });

    const existing = await getExistingTestCaseKeys(agentId);
    expect(existing).toEqual([{ key: "clean_booking", title: "Clean booking success" }]);
  });

  it("returns null from getTestCaseById for a test case belonging to a different location", async () => {
    const otherAgent = await prisma.agent.create({
      data: {
        locationId: OTHER_LOCATION_ID,
        ghlAgentId: "ghl-agent-testcase-other-2",
        name: "Other Agent",
        promptSnapshot: "You are another agent.",
        promptFetchedAt: new Date(),
      },
    });
    const otherCase = await createTestCase({
      agentId: otherAgent.id,
      key: "other_case",
      title: "Other",
      scenario: "s",
      expectedResult: "e",
      transcript: TRANSCRIPT,
    });

    expect(await getTestCaseById(LOCATION_ID, otherCase.id)).toBeNull();
    expect(await getTestCaseById(OTHER_LOCATION_ID, otherCase.id)).not.toBeNull();
  });
});
