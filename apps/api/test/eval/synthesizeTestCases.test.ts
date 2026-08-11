import { beforeEach, describe, expect, it, vi } from "vitest";
import { synthesizeTestCases } from "../../src/eval/synthesizeTestCases.js";
import { anthropic } from "../../src/lib/anthropic.js";

vi.mock("../../src/lib/anthropic.js", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const EXISTING_TEST_CASES = [{ key: "clean_booking", title: "Clean booking success" }];

function testCase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: "pricing_question_unanswerable",
    title: "Pricing question the agent can't answer",
    scenario: "Caller asks how much a service costs.",
    expectedResult: "Agent says it can't discuss pricing and offers a callback.",
    transcript: [
      { role: "AGENT", text: "Hi, thanks for calling! How can I help?" },
      { role: "CALLER", text: "How much does a service cost?" },
      { role: "AGENT", text: "I can't discuss pricing on this call, but I'll have someone call you back." },
    ],
    ...overrides,
  };
}

describe("synthesizeTestCases", () => {
  beforeEach(() => {
    vi.mocked(anthropic.messages.create).mockReset();
  });

  it("parses a valid response", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(JSON.stringify([testCase(), testCase({ key: "other" })])) as never,
    );

    const result = await synthesizeTestCases("Booking Bot", "Some agent prompt", EXISTING_TEST_CASES);
    expect(result).toHaveLength(2);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  it("handles a response wrapped in a code fence despite the JSON-only instruction", async () => {
    const body = JSON.stringify([testCase()]);
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse("```json\n" + body + "\n```") as never);

    const result = await synthesizeTestCases("Booking Bot", "Some agent prompt", EXISTING_TEST_CASES);
    expect(result).toHaveLength(1);
  });

  it("retries once on invalid JSON and succeeds if the retry is valid", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse(JSON.stringify([testCase()])) as never);

    const result = await synthesizeTestCases("Booking Bot", "Some agent prompt", EXISTING_TEST_CASES);
    expect(result).toHaveLength(1);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails loudly if both attempts produce invalid JSON", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse("still not json") as never);

    await expect(synthesizeTestCases("Booking Bot", "Some agent prompt", EXISTING_TEST_CASES)).rejects.toThrow();
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails loudly rather than accepting zero test cases", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify([])) as never);

    await expect(synthesizeTestCases("Booking Bot", "Some agent prompt", EXISTING_TEST_CASES)).rejects.toThrow();
  });

  it("fails loudly rather than accepting more than 8 test cases", async () => {
    const cases = Array.from({ length: 9 }, (_, i) => testCase({ key: `case_${i}` }));
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(cases)) as never);

    await expect(synthesizeTestCases("Booking Bot", "Some agent prompt", EXISTING_TEST_CASES)).rejects.toThrow();
  });

  it("fails loudly rather than accepting a test case with fewer than 2 transcript turns", async () => {
    const cases = [testCase({ transcript: [{ role: "AGENT", text: "Hi there." }] })];
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(cases)) as never);

    await expect(synthesizeTestCases("Booking Bot", "Some agent prompt", EXISTING_TEST_CASES)).rejects.toThrow();
  });
});
