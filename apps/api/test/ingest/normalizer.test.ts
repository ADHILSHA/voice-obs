import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { callLogEntrySchema } from "../../src/ghl/client.js";
import { normalizeCall } from "../../src/ingest/normalizer.js";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "test/fixtures/raw-call-detail-6a6f2559ebdb83152893be53.json",
);

async function loadNormalized() {
  const raw = JSON.parse(await readFile(FIXTURE_PATH, "utf-8"));
  const parsed = callLogEntrySchema.parse(raw);
  return normalizeCall(parsed, "loc-test");
}

// Fixture test against the real captured payload from the Phase 0 spike -- per
// BUILD_SPEC §9, "the highest-value tests in the repo."
describe("normalizeCall (real fixture)", () => {
  it("maps call fields correctly", async () => {
    const { call } = await loadNormalized();

    expect(call.ghlCallId).toBe("6a6f2559ebdb83152893be53");
    expect(call.agentGhlId).toBe("6a6f247d50629a0fcbeb1521");
    expect(call.durationSec).toBe(70);
    expect(call.isTrialCall).toBe(true);
    expect(call.isAgentDeleted).toBe(false);
    expect(call.recordingUrl).toBeNull();
    expect(call.direction).toBeNull();
    expect(call.endedReason).toBeNull();
    expect(call.contactRef).toBe("bv5glb4uFn0VGxcEVzXb");
  });

  it("parses the transcript into 13 alternating turns", async () => {
    const { turns } = await loadNormalized();

    expect(turns).toHaveLength(13);
    expect(turns[0]).toMatchObject({ idx: 0, role: "AGENT" });
    expect(turns[1]).toMatchObject({
      idx: 1,
      role: "CALLER",
      text: "I need to book an appointment.",
    });
    expect(turns.every((t) => t.startMs === null)).toBe(true);
  });

  it("merges a mid-turn blank line into the same turn rather than splitting it", async () => {
    const { turns } = await loadNormalized();

    const mergedTurn = turns.find((t) => t.text.includes("make sure everything's set."));
    expect(mergedTurn?.text).toContain("Thanks for sharing your details, Rohit.");
  });

  it("keeps a genuine interruption as its own turn rather than merging it", async () => {
    const { turns } = await loadNormalized();

    const interruption = turns.find((t) => t.text === "Nine one.");
    expect(interruption).toMatchObject({ role: "CALLER" });
  });
});
