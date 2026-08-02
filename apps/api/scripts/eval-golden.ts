import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Call, Turn } from "../generated/prisma/client.js";
import { TurnRole } from "../generated/prisma/client.js";
import { computeDeterministicMetrics } from "../src/eval/deterministicChecks.js";
import { judgeCall } from "../src/eval/judge.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(dirname, "../test/golden");

interface GoldenTurn {
  idx: number;
  role: "AGENT" | "CALLER" | "SYSTEM";
  text: string;
}

interface GoldenCriterion {
  key: string;
  name: string;
  description: string;
  category: string;
}

interface GoldenFixture {
  name: string;
  agentPrompt: string;
  transcript: GoldenTurn[];
  scorecard: GoldenCriterion[];
  expected: Record<string, string>;
}

// deterministicChecks only reads role/text/startMs off each turn and
// endedReason/actionsTriggered off the call -- minimal stand-ins are enough,
// golden fixtures aren't real DB rows.
function toFakeTurns(transcript: GoldenTurn[]): Turn[] {
  return transcript.map(
    (t) =>
      ({
        id: `golden-${t.idx}`,
        callId: "golden",
        idx: t.idx,
        role: t.role as TurnRole,
        text: t.text,
        startMs: null,
      }) as Turn,
  );
}

const FAKE_CALL = { endedReason: null, actionsTriggered: [] } as unknown as Call;

async function main(): Promise<void> {
  const files = (await readdir(GOLDEN_DIR)).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No golden fixtures found in test/golden/.");
    return;
  }

  const perCriterion = new Map<string, { correct: number; total: number }>();
  let overallCorrect = 0;
  let overallTotal = 0;

  for (const file of files) {
    const fixture = JSON.parse(await readFile(path.join(GOLDEN_DIR, file), "utf-8")) as GoldenFixture;
    const turns = toFakeTurns(fixture.transcript);
    const metrics = computeDeterministicMetrics(FAKE_CALL, turns, []);

    const results = await judgeCall(
      fixture.agentPrompt,
      fixture.scorecard,
      metrics as unknown as Record<string, unknown>,
      fixture.transcript,
    );

    console.log(`\n${fixture.name}:`);
    for (const [key, expectedVerdict] of Object.entries(fixture.expected)) {
      const actual = results.find((r) => r.criterionKey === key);
      const actualVerdict = actual?.verdict ?? "MISSING";
      const correct = actualVerdict === expectedVerdict;

      const stats = perCriterion.get(key) ?? { correct: 0, total: 0 };
      stats.total += 1;
      if (correct) stats.correct += 1;
      perCriterion.set(key, stats);

      overallTotal += 1;
      if (correct) overallCorrect += 1;

      console.log(`  ${correct ? "PASS" : "FAIL"} ${key}: expected=${expectedVerdict} actual=${actualVerdict}`);
    }
  }

  console.log("\n--- Per-criterion agreement ---");
  for (const [key, stats] of perCriterion) {
    console.log(`  ${key}: ${stats.correct}/${stats.total} (${((stats.correct / stats.total) * 100).toFixed(0)}%)`);
  }

  const accuracyPct = ((overallCorrect / overallTotal) * 100).toFixed(1);
  console.log(`\nOverall accuracy: ${overallCorrect}/${overallTotal} (${accuracyPct}%)`);
  console.log(
    `\nNote: golden set currently has ${files.length} hand-labeled call(s). BUILD_SPEC's target is 20 -- ` +
      "not yet reached, pending more real sandbox calls or Phase 7's seed script.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
