import { describe, expect, it } from "vitest";
import { applyPromptDiff } from "../../src/eval/applyRecommendation.js";

const PROMPT = "Line one.\nAlways say the price is $50.\nLine three.";

describe("applyPromptDiff", () => {
  it("replaces a verbatim substring", () => {
    const result = applyPromptDiff(
      { before: "Always say the price is $50.", after: "Never state a price." },
      PROMPT,
    );
    expect(result).toBe("Line one.\nNever state a price.\nLine three.");
  });

  it("throws when before no longer matches the live prompt", () => {
    expect(() => applyPromptDiff({ before: "This text is not in the prompt", after: "x" }, PROMPT)).toThrow(
      /no longer matches/,
    );
  });

  it("inserts after the given line when before is empty", () => {
    const result = applyPromptDiff({ before: "", after: "New rule.", insertAfterLine: 1 }, PROMPT);
    expect(result).toBe("Line one.\nNew rule.\nAlways say the price is $50.\nLine three.");
  });

  it("throws when before is empty and insertAfterLine is missing", () => {
    expect(() => applyPromptDiff({ before: "", after: "New rule." }, PROMPT)).toThrow(/insertAfterLine/);
  });

  it("throws when insertAfterLine is out of range", () => {
    expect(() => applyPromptDiff({ before: "", after: "x", insertAfterLine: 99 }, PROMPT)).toThrow(/out of range/);
  });
});
