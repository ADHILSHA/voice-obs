import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CriterionCategory, EvalMethod, ScorecardSource, Severity } from "../../generated/prisma/client.js";
import { prisma } from "../../src/db/client.js";
import {
  createScorecardVersion,
  getActiveScorecard,
  getScorecardVersion,
  type CriterionInput,
} from "../../src/db/scorecards.js";

const LOCATION_ID = "loc-test-scorecards";

const BASE_CRITERION: CriterionInput = {
  key: "test_criterion",
  name: "Test criterion",
  description: "A test criterion.",
  category: CriterionCategory.GOAL,
  severity: Severity.MEDIUM,
  weight: 1,
  method: EvalMethod.LLM,
};

let agentId: string;

async function cleanup(): Promise<void> {
  await prisma.criterion.deleteMany({ where: { scorecard: { agent: { locationId: LOCATION_ID } } } });
  await prisma.scorecard.deleteMany({ where: { agent: { locationId: LOCATION_ID } } });
  await prisma.agent.deleteMany({ where: { locationId: LOCATION_ID } });
}

describe("createScorecardVersion", () => {
  beforeEach(async () => {
    await cleanup();
    const agent = await prisma.agent.create({
      data: {
        locationId: LOCATION_ID,
        ghlAgentId: "ghl-agent-test",
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

  it("creates version 1 as active", async () => {
    const scorecard = await createScorecardVersion(agentId, [BASE_CRITERION], ScorecardSource.GENERATED);
    expect(scorecard.version).toBe(1);
    expect(scorecard.isActive).toBe(true);
    expect(scorecard.criteria).toHaveLength(1);
  });

  it("creates version 2 and deactivates version 1 without touching its criteria", async () => {
    await createScorecardVersion(agentId, [BASE_CRITERION], ScorecardSource.GENERATED);
    const v2 = await createScorecardVersion(
      agentId,
      [{ ...BASE_CRITERION, key: "test_criterion_v2" }],
      ScorecardSource.MANUAL,
    );

    expect(v2.version).toBe(2);
    expect(v2.isActive).toBe(true);

    const v1Reloaded = await getScorecardVersion(agentId, 1);
    expect(v1Reloaded?.isActive).toBe(false);
    expect(v1Reloaded?.criteria).toHaveLength(1);
    expect(v1Reloaded?.criteria[0]?.key).toBe("test_criterion");

    const active = await getActiveScorecard(agentId);
    expect(active?.version).toBe(2);
  });
});
