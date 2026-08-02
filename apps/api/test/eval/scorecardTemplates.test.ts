import { describe, expect, it } from "vitest";
import { SCORECARD_TEMPLATES } from "../../src/eval/scorecardTemplates.js";

const VALID_CATEGORIES = ["goal", "data_capture", "knowledge", "containment", "compliance", "conversational"];
const VALID_SEVERITIES = ["low", "medium", "high", "critical"];

describe("SCORECARD_TEMPLATES", () => {
  it("has exactly 3 templates", () => {
    expect(SCORECARD_TEMPLATES).toHaveLength(3);
  });

  for (const template of SCORECARD_TEMPLATES) {
    describe(template.id, () => {
      it("has between 6 and 10 criteria", () => {
        expect(template.criteria.length).toBeGreaterThanOrEqual(6);
        expect(template.criteria.length).toBeLessThanOrEqual(10);
      });

      it("has valid category/severity values and unique snake_case keys", () => {
        const keys = new Set<string>();
        for (const criterion of template.criteria) {
          expect(VALID_CATEGORIES).toContain(criterion.category);
          expect(VALID_SEVERITIES).toContain(criterion.severity);
          expect(criterion.key).toMatch(/^[a-z][a-z0-9_]*$/);
          expect(keys.has(criterion.key)).toBe(false);
          keys.add(criterion.key);
        }
      });
    });
  }
});
