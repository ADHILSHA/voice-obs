import { beforeEach, describe, expect, it, vi } from "vitest";
import { suggestScorecardCriteria } from "../../src/eval/suggestCriteria.js";
import { anthropic } from "../../src/lib/anthropic.js";

vi.mock("../../src/lib/anthropic.js", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const EXISTING_CRITERIA = [
  { key: "greets_caller", name: "Greets caller", description: "Opens the call with a greeting." },
];

function suggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: "confirms_timezone",
    name: "Confirms timezone",
    description: "Confirms the caller's timezone before booking.",
    category: "goal",
    severity: "medium",
    weight: 1,
    ...overrides,
  };
}

describe("suggestScorecardCriteria", () => {
  beforeEach(() => {
    vi.mocked(anthropic.messages.create).mockReset();
  });

  it("parses a valid response", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(
        JSON.stringify({ useCase: "appointment booking", suggestions: [suggestion(), suggestion({ key: "other" })] }),
      ) as never,
    );

    const result = await suggestScorecardCriteria("Booking Bot", "Some agent prompt", EXISTING_CRITERIA);
    expect(result.useCase).toBe("appointment booking");
    expect(result.suggestions).toHaveLength(2);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  it("handles a response wrapped in a code fence despite the JSON-only instruction", async () => {
    const body = JSON.stringify({ useCase: "appointment booking", suggestions: [suggestion()] });
    vi.mocked(anthropic.messages.create).mockResolvedValue(textResponse("```json\n" + body + "\n```") as never);

    const result = await suggestScorecardCriteria("Booking Bot", "Some agent prompt", EXISTING_CRITERIA);
    expect(result.suggestions).toHaveLength(1);
  });

  it("retries once on invalid JSON and succeeds if the retry is valid", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(
        textResponse(JSON.stringify({ useCase: "appointment booking", suggestions: [suggestion()] })) as never,
      );

    const result = await suggestScorecardCriteria("Booking Bot", "Some agent prompt", EXISTING_CRITERIA);
    expect(result.suggestions).toHaveLength(1);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("fails loudly if both attempts produce invalid JSON", async () => {
    vi.mocked(anthropic.messages.create)
      .mockResolvedValueOnce(textResponse("not json") as never)
      .mockResolvedValueOnce(textResponse("still not json") as never);

    await expect(
      suggestScorecardCriteria("Booking Bot", "Some agent prompt", EXISTING_CRITERIA),
    ).rejects.toThrow();
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  it("allows zero suggestions when the scorecard already covers the use case", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(JSON.stringify({ useCase: "appointment booking", suggestions: [] })) as never,
    );

    const result = await suggestScorecardCriteria("Booking Bot", "Some agent prompt", EXISTING_CRITERIA);
    expect(result.suggestions).toHaveLength(0);
  });

  it("fails loudly rather than accepting more than 6 suggestions", async () => {
    const suggestions = Array.from({ length: 7 }, (_, i) => suggestion({ key: `criterion_${i}` }));
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(JSON.stringify({ useCase: "appointment booking", suggestions })) as never,
    );

    await expect(
      suggestScorecardCriteria("Booking Bot", "Some agent prompt", EXISTING_CRITERIA),
    ).rejects.toThrow();
  });

  it("drops a suggestion whose key collides with an existing criterion", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(
        JSON.stringify({
          useCase: "appointment booking",
          suggestions: [suggestion({ key: "greets_caller" }), suggestion({ key: "confirms_timezone" })],
        }),
      ) as never,
    );

    const result = await suggestScorecardCriteria("Booking Bot", "Some agent prompt", EXISTING_CRITERIA);
    expect(result.suggestions.map((s) => s.key)).toEqual(["confirms_timezone"]);
  });

  it("keeps only the first suggestion when two share the same key", async () => {
    vi.mocked(anthropic.messages.create).mockResolvedValue(
      textResponse(
        JSON.stringify({
          useCase: "appointment booking",
          suggestions: [
            suggestion({ key: "confirms_timezone", name: "First" }),
            suggestion({ key: "confirms_timezone", name: "Second" }),
          ],
        }),
      ) as never,
    );

    const result = await suggestScorecardCriteria("Booking Bot", "Some agent prompt", EXISTING_CRITERIA);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].name).toBe("First");
  });
});
