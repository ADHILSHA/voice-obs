import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/client.js";
import { getAgent, getCallLog } from "../../src/ghl/client.js";
import { resolveAccessToken } from "../../src/ghl/tokens.js";
import { ingestCall } from "../../src/ingest/ingestCall.js";

// Integration test against real Postgres (docker-compose) -- only the GHL HTTP
// boundary is mocked, same pattern as test/ghl/tokens.test.ts.
vi.mock("../../src/ghl/client.js", () => ({
  getCallLog: vi.fn(),
  getAgent: vi.fn(),
}));
vi.mock("../../src/ghl/tokens.js", () => ({
  resolveAccessToken: vi.fn(),
}));

const LOCATION_ID = "loc-test-ingest";
const GHL_AGENT_ID = "agent-1";
const GHL_CALL_ID = "call-1";

const MOCK_AGENT = {
  id: GHL_AGENT_ID,
  locationId: LOCATION_ID,
  agentName: "Test Agent",
  agentPrompt: "You are a test agent.",
  actions: [],
};

const MOCK_CALL = {
  id: GHL_CALL_ID,
  contactId: "contact-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  duration: 42,
  agentId: GHL_AGENT_ID,
  isAgentDeleted: false,
  summary: "Test call summary",
  transcript: "bot:Hello there.\nhuman:Hi, my number is 914-810-3924.\n",
  translation: null,
  extractedData: {},
  trialCall: true,
  executedCallActions: [],
};

async function cleanup(): Promise<void> {
  await prisma.turn.deleteMany({ where: { call: { locationId: LOCATION_ID } } });
  await prisma.call.deleteMany({ where: { locationId: LOCATION_ID } });
  await prisma.agent.deleteMany({ where: { locationId: LOCATION_ID } });
}

describe("ingestCall", () => {
  beforeEach(async () => {
    vi.mocked(resolveAccessToken).mockReset().mockResolvedValue("fake-token");
    vi.mocked(getCallLog).mockReset().mockResolvedValue(MOCK_CALL as never);
    vi.mocked(getAgent).mockReset().mockResolvedValue(MOCK_AGENT as never);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("creates one Call row with correctly parsed and redacted turns", async () => {
    await ingestCall(LOCATION_ID, GHL_CALL_ID);

    const call = await prisma.call.findUnique({
      where: { locationId_ghlCallId: { locationId: LOCATION_ID, ghlCallId: GHL_CALL_ID } },
      include: { turns: { orderBy: { idx: "asc" } } },
    });

    expect(call).not.toBeNull();
    expect(call?.turns).toHaveLength(2);
    expect(call?.turns[1]?.text).toContain("{{PHONE_1}}");
    expect(call?.turns[1]?.text).not.toContain("914-810-3924");
    expect(call?.redactionMap).not.toBeNull();
  });

  it("running twice does not duplicate the Call or Turn rows", async () => {
    await ingestCall(LOCATION_ID, GHL_CALL_ID);
    await ingestCall(LOCATION_ID, GHL_CALL_ID);

    const calls = await prisma.call.findMany({
      where: { locationId: LOCATION_ID, ghlCallId: GHL_CALL_ID },
      include: { turns: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.turns).toHaveLength(2);
  });

  it("reuses the Agent row on the second run instead of re-fetching it", async () => {
    await ingestCall(LOCATION_ID, GHL_CALL_ID);
    await ingestCall(LOCATION_ID, GHL_CALL_ID);

    expect(getAgent).toHaveBeenCalledTimes(1);
    const agents = await prisma.agent.findMany({ where: { locationId: LOCATION_ID } });
    expect(agents).toHaveLength(1);
  });
});
