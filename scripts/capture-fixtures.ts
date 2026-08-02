import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(dirname, "../.env") });

const GHL_PIT = process.env.GHL_PIT;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

if (!GHL_PIT || !GHL_LOCATION_ID) {
  throw new Error("GHL_PIT and GHL_LOCATION_ID must be set in .env");
}

// Ground truth per BUILD_SPEC.md section 2. The version header is flagged there as
// "confirm during the spike" -- this run is that confirmation.
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

const FIXTURES_DIR = path.join(dirname, "../apps/api/test/fixtures");

const headers = {
  Authorization: `Bearer ${GHL_PIT}`,
  Version: GHL_API_VERSION,
  Accept: "application/json",
};

const summary: { label: string; keys: string[] }[] = [];

function logTopLevelKeys(label: string, body: unknown): void {
  const keys = body && typeof body === "object" ? Object.keys(body) : [];
  console.log(`${label} -> top-level keys: [${keys.join(", ")}]`);
  summary.push({ label, keys });
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status} ${res.statusText}: ${JSON.stringify(body)}`);
  }
  return body;
}

// The list response shape is unknown until this script runs. Look for the first
// array anywhere in the top-level object rather than assuming a wrapper key name.
function findCallEntries(listResponse: unknown): unknown[] {
  if (Array.isArray(listResponse)) return listResponse;
  if (listResponse && typeof listResponse === "object") {
    for (const value of Object.values(listResponse)) {
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

// Same reasoning: the id field name is unconfirmed, so check the common candidates
// instead of assuming one.
function findCallId(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  for (const key of ["id", "_id", "callId"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

async function main(): Promise<void> {
  await mkdir(FIXTURES_DIR, { recursive: true });

  // Query param name is GHL's near-universal v2 convention; not literally confirmed
  // by BUILD_SPEC.md. If this comes back empty, check this first.
  const listUrl = `${GHL_API_BASE}/voice-ai/dashboard/call-logs?locationId=${GHL_LOCATION_ID}`;
  const listResponse = await fetchJson(listUrl);
  logTopLevelKeys("call-logs list", listResponse);
  await writeFile(
    path.join(FIXTURES_DIR, "raw-calls.json"),
    JSON.stringify(listResponse, null, 2),
  );

  const entries = findCallEntries(listResponse);
  console.log(`Found ${entries.length} call log entries in the list response.`);

  for (const entry of entries) {
    const callId = findCallId(entry);
    if (!callId) {
      console.warn("Skipping an entry with no recognizable id field (checked id, _id, callId).");
      continue;
    }

    const detailUrl = `${GHL_API_BASE}/voice-ai/dashboard/call-logs/${callId}?locationId=${GHL_LOCATION_ID}`;
    try {
      const detail = await fetchJson(detailUrl);
      logTopLevelKeys(`call detail ${callId}`, detail);
      await writeFile(
        path.join(FIXTURES_DIR, `raw-call-detail-${callId}.json`),
        JSON.stringify(detail, null, 2),
      );
    } catch (err) {
      console.warn(`Failed to fetch detail for call ${callId}:`, err);
    }
  }

  await writeFile(
    path.join(FIXTURES_DIR, "raw-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(`Wrote top-level key summary for ${summary.length} response(s) to raw-summary.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
