import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(dirname, "../apps/api/test/fixtures");

const summary: { label: string; keys: string[] }[] = [];

function logTopLevelKeys(label: string, body: unknown): void {
  const keys = body && typeof body === "object" ? Object.keys(body) : [];
  console.log(`${label} -> top-level keys: [${keys.join(", ")}]`);
  summary.push({ label, keys });
}

// Uses the real, Zod-validated ghl/client.ts functions and whatever Installation
// is on file (OAuth or PIT) via resolveAccessToken, rather than hand-rolled fetch
// calls against a bare GHL_PIT. Phase 0's version had to guess defensively because
// nothing was confirmed yet; now that the client is built and tested, re-running
// this script is also a smoke test of it, not just a fixture dump. Requires
// docker-compose up (resolveAccessToken reads the Installation from Postgres).
async function main(): Promise<void> {
  // apps/api/src/config/env.ts resolves .env relative to process.cwd(), assuming
  // it's always apps/api (true for every apps/api-internal npm script). This
  // script runs from the repo root, so it has to satisfy that assumption itself
  // before importing anything that pulls env.ts in transitively.
  process.chdir(path.join(dirname, "../apps/api"));

  const { resolveAccessToken } = await import("../apps/api/src/ghl/tokens.js");
  const { listCallLogs, getCallLog, listAgents, getAgent } = await import("../apps/api/src/ghl/client.js");
  const { env } = await import("../apps/api/src/config/env.js");

  const locationId = env.GHL_LOCATION_ID;
  const token = await resolveAccessToken(locationId);

  await mkdir(FIXTURES_DIR, { recursive: true });

  const callLogs = await listCallLogs(token, locationId, { page: 1, pageSize: 50 });
  logTopLevelKeys("call-logs list", callLogs);
  await writeFile(path.join(FIXTURES_DIR, "raw-calls.json"), JSON.stringify(callLogs, null, 2));

  for (const entry of callLogs.callLogs) {
    const detail = await getCallLog(token, locationId, entry.id);
    logTopLevelKeys(`call detail ${entry.id}`, detail);
    await writeFile(
      path.join(FIXTURES_DIR, `raw-call-detail-${entry.id}.json`),
      JSON.stringify(detail, null, 2),
    );
  }

  const agents = await listAgents(token, locationId);
  logTopLevelKeys("agents list", agents);
  await writeFile(path.join(FIXTURES_DIR, "raw-agents.json"), JSON.stringify(agents, null, 2));

  for (const agentEntry of agents.agents) {
    const detail = await getAgent(token, locationId, agentEntry.id);
    logTopLevelKeys(`agent detail ${agentEntry.id}`, detail);
    await writeFile(
      path.join(FIXTURES_DIR, `raw-agent-detail-${agentEntry.id}.json`),
      JSON.stringify(detail, null, 2),
    );
  }

  await writeFile(path.join(FIXTURES_DIR, "raw-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`Wrote top-level key summary for ${summary.length} response(s) to raw-summary.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
