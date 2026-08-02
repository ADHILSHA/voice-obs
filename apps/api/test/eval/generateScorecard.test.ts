import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateScorecardCriteria } from "../../src/eval/generateScorecard.js";
import { anthropic } from "../../src/lib/anthropic.js";

vi.mock("../../src/lib/anthropic.js", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const VALID_CRITERIA = Array.from({ length: 6 }, (_, i) => ({
  key: `criterion_${i}`,
  name: `Criterion ${i}`,
  description: "Some description.",
  category: "goal",
  severity: "medium",
  weight: 1,
}));

describe("generateScorecardCriteria", () => {
  beforeEach(() => {
    vi.mocked(anthropic.messages.create).mockReset();
  });

  it("parses a valid response", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(JSON.stringify(VALID_CRITERIA)) as never,
    );

    const result = await generateScorecardCriteria("Some agent prompt");
    expect(result).toHaveLength(6);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  it("handles a response wrapped in a code fence despite the JSON-only instruction", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse("```json\n" + JSON.stringify(VALID_CRITERIA) + "\n```") as never,
    );

    const result = await generateScorecardCriteria("Some agent prompt");
    expect(result).toHaveLength(6);
  });

  it("retries once on invalid JSON and succeeds if the retry is valid", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse(JSON.stringify(VALID_CRITERIA)) as never);

    const result = await generateScorecardCriteria("Some agent prompt");
    expect(result).toHaveLength(6);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails loudly if both attempts produce invalid JSON", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse("still not json") as never);

    await expect(generateScorecardCriteria("Some agent prompt")).rejects.toThrow();
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails loudly rather than accepting fewer than 6 criteria", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(JSON.stringify(VALID_CRITERIA.slice(0, 3))) as never,
    );

    await expect(generateScorecardCriteria("Some agent prompt")).rejects.toThrow();
  });
});
