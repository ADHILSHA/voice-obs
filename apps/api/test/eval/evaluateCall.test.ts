import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CriterionCategory,
  EvalMethod,
  ScorecardSource,
  Severity,
} from "../../generated/prisma/client.js";
import { prisma } from "../../src/db/client.js";
import { createScorecardVersion } from "../../src/db/scorecards.js";
import { evaluateCall } from "../../src/eval/evaluateCall.js";
import { judgeCall } from "../../src/eval/judge.js";

// Integration test against real Postgres -- only the judge (the Anthropic
// boundary) is mocked, same pattern as test/ghl/tokens.test.ts and
// test/ingest/ingestCall.test.ts.
vi.mock("../../src/eval/judge.js", () => ({
  judgeCall: vi.fn(),
}));

const LOCATION_ID = "loc-test-evaluate-call";
let agentId: string;
let callId: string;

async function cleanup(): Promise<void> {
  await prisma.criterionResult.deleteMany({ where: { evaluation: { call: { locationId: LOCATION_ID } } } });
  await prisma.evaluation.deleteMany({ where: { call: { locationId: LOCATION_ID } } });
  await prisma.turn.deleteMany({ where: { call: { locationId: LOCATION_ID } } });
  await prisma.call.deleteMany({ where: { locationId: LOCATION_ID } });
  await prisma.criterion.deleteMany({ where: { scorecard: { agent: { locationId: LOCATION_ID } } } });
  await prisma.scorecard.deleteMany({ where: { agent: { locationId: LOCATION_ID } } });
  await prisma.agent.deleteMany({ where: { locationId: LOCATION_ID } });
}

describe("evaluateCall", () => {
  beforeEach(async () => {
    await cleanup();
    vi.mocked(judgeCall).mockReset();
    vi.mocked(judgeCall).mockResolvedValue([
      {
        criterionKey: "test_criterion",
        verdict: "pass",
        confidence: 0.9,
        evidenceTurns: [0],
        rationale: "Test rationale.",
        lowTrust: false,
      },
    ] as never);

    const agent = await prisma.agent.create({
      data: {
        locationId: LOCATION_ID,
        ghlAgentId: "ghl-agent-eval-test",
        name: "Test Agent",
        promptSnapshot: "You are a test agent.",
        promptFetchedAt: new Date(),
      },
    });
    agentId = agent.id;

    await createScorecardVersion(
      agentId,
      [
        {
          key: "test_criterion",
          name: "Test criterion",
          description: "A test criterion.",
          category: CriterionCategory.GOAL,
          severity: Severity.MEDIUM,
          weight: 1,
          method: EvalMethod.LLM,
        },
      ],
      ScorecardSource.GENERATED,
    );

    const call = await prisma.call.create({
      data: {
        locationId: LOCATION_ID,
        agentId,
        ghlCallId: "ghl-call-eval-test",
        startedAt: new Date(),
        durationSec: 10,
        actionsTriggered: [],
        rawPayload: {},
        turns: { create: [{ idx: 0, role: "AGENT", text: "Hello there." }] },
      },
    });
    callId = call.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates an Evaluation with CriterionResults", async () => {
    await evaluateCall(callId);

    const evaluation = await prisma.evaluation.findFirst({ where: { callId }, include: { results: true } });
    expect(evaluation).not.toBeNull();
    expect(evaluation?.results).toHaveLength(1);
    expect(evaluation?.results[0]?.verdict).toBe("PASS");
    expect(evaluation?.healthScore).toBe(1);
  });

  it("a second run with the same input hits the cache and calls the judge exactly once", async () => {
    await evaluateCall(callId);
    await evaluateCall(callId);

    expect(judgeCall).toHaveBeenCalledTimes(1);
    const evaluations = await prisma.evaluation.findMany({ where: { callId } });
    expect(evaluations).toHaveLength(1);
  });
});
