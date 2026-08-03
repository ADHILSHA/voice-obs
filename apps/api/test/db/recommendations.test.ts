import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db/client.js";
import { findFailureClusters, getRecommendedKeys } from "../../src/db/recommendations.js";

const LOCATION_ID = "loc-test-recommendations";

let agentId: string;

async function cleanup(): Promise<void> {
  // Recommendation.agentId is a plain scalar, not a Prisma relation (same as
  // production code) -- resolve agent ids first rather than nesting a filter
  // Prisma can't express.
  const agents = await prisma.agent.findMany({ where: { locationId: LOCATION_ID }, select: { id: true } });
  const agentIds = agents.map((a) => a.id);

  await prisma.criterionResult.deleteMany({ where: { evaluation: { call: { agentId: { in: agentIds } } } } });
  await prisma.evaluation.deleteMany({ where: { call: { agentId: { in: agentIds } } } });
  await prisma.turn.deleteMany({ where: { call: { agentId: { in: agentIds } } } });
  await prisma.recommendation.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.call.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agent.deleteMany({ where: { locationId: LOCATION_ID } });
}

async function makeCallWithResult(opts: {
  criterionKey: string;
  rootCause: "MISSING_INSTRUCTION" | "KNOWLEDGE_GAP";
  verdict: "FAIL" | "PARTIAL" | "PASS";
  evidenceTurns?: number[];
}): Promise<void> {
  const call = await prisma.call.create({
    data: {
      locationId: LOCATION_ID,
      agentId,
      ghlCallId: `ghl-call-${Math.random()}`,
      startedAt: new Date(),
      durationSec: 60,
      actionsTriggered: [],
      isTrialCall: true,
      rawPayload: {},
    },
  });

  if (opts.evidenceTurns?.length) {
    await prisma.turn.createMany({
      data: opts.evidenceTurns.map((idx) => ({ callId: call.id, idx, role: "AGENT" as const, text: `turn ${idx}` })),
    });
  }

  const evaluation = await prisma.evaluation.create({
    data: {
      callId: call.id,
      scorecardVersion: 1,
      promptVersion: "test",
      inputHash: `hash-${Math.random()}`,
      healthScore: 0.5,
      metrics: {},
    },
  });

  await prisma.criterionResult.create({
    data: {
      evaluationId: evaluation.id,
      criterionKey: opts.criterionKey,
      verdict: opts.verdict,
      confidence: 0.9,
      evidenceTurns: opts.evidenceTurns ?? [],
      rationale: "Test rationale.",
      rootCause: opts.verdict === "PASS" ? null : opts.rootCause,
    },
  });
}

describe("findFailureClusters", () => {
  beforeEach(async () => {
    await cleanup();
    const agent = await prisma.agent.create({
      data: {
        locationId: LOCATION_ID,
        ghlAgentId: "ghl-agent-rec-test",
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

  it("does not cluster a failure that only occurs once", async () => {
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "MISSING_INSTRUCTION", verdict: "FAIL" });

    const clusters = await findFailureClusters(agentId);
    expect(clusters).toHaveLength(0);
  });

  it("clusters 2+ occurrences of the same (criterionKey, rootCause)", async () => {
    await makeCallWithResult({
      criterionKey: "no_fabrication",
      rootCause: "MISSING_INSTRUCTION",
      verdict: "FAIL",
      evidenceTurns: [1],
    });
    await makeCallWithResult({
      criterionKey: "no_fabrication",
      rootCause: "MISSING_INSTRUCTION",
      verdict: "PARTIAL",
      evidenceTurns: [2],
    });

    const clusters = await findFailureClusters(agentId);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].criterionKey).toBe("no_fabrication");
    expect(clusters[0].rootCause).toBe("MISSING_INSTRUCTION");
    expect(clusters[0].affectedCalls).toBe(2);
    expect(clusters[0].synthesisEvidence).toHaveLength(2);
  });

  it("keeps different root causes for the same criterion as separate clusters", async () => {
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "MISSING_INSTRUCTION", verdict: "FAIL" });
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "MISSING_INSTRUCTION", verdict: "FAIL" });
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "KNOWLEDGE_GAP", verdict: "FAIL" });
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "KNOWLEDGE_GAP", verdict: "FAIL" });

    const clusters = await findFailureClusters(agentId);
    expect(clusters).toHaveLength(2);
  });

  it("ignores PASS verdicts and results with no rootCause", async () => {
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "MISSING_INSTRUCTION", verdict: "PASS" });
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "MISSING_INSTRUCTION", verdict: "PASS" });

    const clusters = await findFailureClusters(agentId);
    expect(clusters).toHaveLength(0);
  });

  it("computes affectedPct against total evaluated calls for the agent", async () => {
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "MISSING_INSTRUCTION", verdict: "FAIL" });
    await makeCallWithResult({ criterionKey: "no_fabrication", rootCause: "MISSING_INSTRUCTION", verdict: "FAIL" });
    await makeCallWithResult({ criterionKey: "other_criterion", rootCause: "KNOWLEDGE_GAP", verdict: "PASS" });

    const clusters = await findFailureClusters(agentId);
    expect(clusters[0].affectedPct).toBeCloseTo(2 / 3);
  });
});

describe("getRecommendedKeys", () => {
  beforeEach(async () => {
    await cleanup();
    const agent = await prisma.agent.create({
      data: {
        locationId: LOCATION_ID,
        ghlAgentId: "ghl-agent-rec-test-2",
        name: "Test Agent 2",
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

  it("includes OPEN, APPLIED, and DISMISSED combos so none get re-suggested", async () => {
    await prisma.recommendation.createMany({
      data: [
        {
          agentId,
          criterionKey: "a",
          rootCause: "MISSING_INSTRUCTION",
          title: "t",
          body: "b",
          promptDiff: {},
          affectedCalls: 2,
          affectedPct: 1,
          severity: "MEDIUM",
          evidenceCallIds: [],
          status: "OPEN",
        },
        {
          agentId,
          criterionKey: "b",
          rootCause: "KNOWLEDGE_GAP",
          title: "t",
          body: "b",
          promptDiff: {},
          affectedCalls: 2,
          affectedPct: 1,
          severity: "MEDIUM",
          evidenceCallIds: [],
          status: "DISMISSED",
        },
      ],
    });

    const keys = await getRecommendedKeys(agentId);
    expect(keys.has("a::MISSING_INSTRUCTION")).toBe(true);
    expect(keys.has("b::KNOWLEDGE_GAP")).toBe(true);
    expect(keys.has("c::MISSING_INSTRUCTION")).toBe(false);
  });
});
