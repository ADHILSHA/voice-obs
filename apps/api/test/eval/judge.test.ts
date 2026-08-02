import { beforeEach, describe, expect, it, vi } from "vitest";
import { judgeCall } from "../../src/eval/judge.js";
import { anthropic } from "../../src/lib/anthropic.js";

vi.mock("../../src/lib/anthropic.js", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const CRITERIA = [{ key: "test_key", name: "Test", description: "desc", category: "goal" }];
const TURNS = [
  { idx: 0, role: "AGENT" as const, text: "Hello" },
  { idx: 1, role: "CALLER" as const, text: "Hi" },
];

const VALID_RESULT = [
  {
    criterionKey: "test_key",
    verdict: "pass",
    confidence: 0.9,
    evidenceTurns: [0],
    rationale: "The agent greeted the caller.",
  },
];

describe("judgeCall", () => {
  beforeEach(() => {
    vi.mocked(anthropic.messages.create).mockReset();
  });

  it("parses a valid response", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(JSON.stringify(VALID_RESULT)) as never,
    );
    const results = await judgeCall("prompt", CRITERIA, {}, TURNS);
    expect(results).toHaveLength(1);
    expect(results[0]?.verdict).toBe("pass");
    expect(results[0]?.lowTrust).toBe(false);
  });

  it("retries once on invalid JSON and succeeds if the retry is valid", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse(JSON.stringify(VALID_RESULT)) as never);

    const results = await judgeCall("prompt", CRITERIA, {}, TURNS);
    expect(results).toHaveLength(1);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails loudly if both attempts produce invalid JSON", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse("still not json") as never);

    await expect(judgeCall("prompt", CRITERIA, {}, TURNS)).rejects.toThrow();
  });

  it("drops an evidenceTurns index that doesn't exist on the call", async () => {
    const result = [{ ...VALID_RESULT[0], evidenceTurns: [0, 99] }];
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(result)) as never);

    const results = await judgeCall("prompt", CRITERIA, {}, TURNS);
    expect(results[0]?.evidenceTurns).toEqual([0]);
    expect(results[0]?.lowTrust).toBe(false);
  });

  it("flags a result low-trust when ALL evidenceTurns indices are invalid", async () => {
    const result = [{ ...VALID_RESULT[0], evidenceTurns: [99, 100] }];
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(result)) as never);

    const results = await judgeCall("prompt", CRITERIA, {}, TURNS);
    expect(results[0]?.evidenceTurns).toEqual([]);
    expect(results[0]?.lowTrust).toBe(true);
  });

  it("does not flag low-trust when evidenceTurns was legitimately empty", async () => {
    const result = [{ ...VALID_RESULT[0], evidenceTurns: [] }];
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(result)) as never);

    const results = await judgeCall("prompt", CRITERIA, {}, TURNS);
    expect(results[0]?.lowTrust).toBe(false);
  });
});
