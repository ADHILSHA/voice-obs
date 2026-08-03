import { beforeEach, describe, expect, it, vi } from "vitest";
import { synthesizeRecommendation } from "../../src/eval/synthesizeRecommendation.js";
import { anthropic } from "../../src/lib/anthropic.js";

vi.mock("../../src/lib/anthropic.js", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const AGENT_PROMPT = "Line one.\nAlways say the price is $50.\nLine three.";

const INPUT = {
  agentPrompt: AGENT_PROMPT,
  criterionName: "No fabricated pricing",
  criterionDescription: "Agent never states a price not provided by the operator.",
  rootCause: "missing_instruction",
  evidence: [{ rationale: "Agent invented a $50 price.", turns: [{ idx: 3, role: "AGENT", text: "It's $50." }] }],
};

const VALID_REPLACE = {
  title: "Stop inventing prices",
  body: "Removes the line that states an unverified price.",
  promptDiff: { before: "Always say the price is $50.", after: "If asked about price, say a team member will follow up." },
};

const VALID_INSERT = {
  title: "Add a pricing fallback",
  body: "Inserts an explicit no-pricing rule.",
  promptDiff: { before: "", after: "Never state a price unless explicitly provided.", insertAfterLine: 1 },
};

describe("synthesizeRecommendation", () => {
  beforeEach(() => {
    vi.mocked(anthropic.messages.create).mockReset();
  });

  it("parses a valid literal-replace response", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(VALID_REPLACE)) as never);

    const result = await synthesizeRecommendation(INPUT);
    expect(result.title).toBe(VALID_REPLACE.title);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  it("parses a valid insertion response", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(VALID_INSERT)) as never);

    const result = await synthesizeRecommendation(INPUT);
    expect(result.promptDiff.insertAfterLine).toBe(1);
  });

  it("retries once on invalid JSON and succeeds if the retry is valid", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse(JSON.stringify(VALID_REPLACE)) as never);

    const result = await synthesizeRecommendation(INPUT);
    expect(result.title).toBe(VALID_REPLACE.title);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("retries once when promptDiff.before is not a verbatim substring, then fails loudly if the retry is also wrong", async () => {
    const paraphrased = { ...VALID_REPLACE, promptDiff: { ...VALID_REPLACE.promptDiff, before: "Say fifty dollars." } };
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(paraphrased)) as never);

    await expect(synthesizeRecommendation(INPUT)).rejects.toThrow(/verbatim/);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails loudly when before is empty and insertAfterLine is missing", async () => {
    const invalid = { ...VALID_INSERT, promptDiff: { before: "", after: "text" } };
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse(JSON.stringify(invalid)) as never);

    await expect(synthesizeRecommendation(INPUT)).rejects.toThrow();
  });

  it("fails loudly if both attempts produce invalid JSON", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse("still not json") as never);

    await expect(synthesizeRecommendation(INPUT)).rejects.toThrow();
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });
});
