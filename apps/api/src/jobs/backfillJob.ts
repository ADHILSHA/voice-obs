import { listCallLogs } from "../ghl/client.js";
import { resolveAccessToken } from "../ghl/tokens.js";
import { ingestCall } from "../ingest/ingestCall.js";
import { redis } from "../lib/redis.js";

const PAGE_SIZE = 50;

export interface BackfillStatus {
  state: "running" | "completed" | "failed";
  processed: number;
  total: number;
}

function progressKey(locationId: string): string {
  return `backfill:progress:${locationId}`;
}

async function setProgress(locationId: string, status: BackfillStatus): Promise<void> {
  await redis.set(progressKey(locationId), JSON.stringify(status));
}

export async function getBackfillStatus(locationId: string): Promise<BackfillStatus | null> {
  const raw = await redis.get(progressKey(locationId));
  return raw ? (JSON.parse(raw) as BackfillStatus) : null;
}

// listCallLogs' startDate/endDate params aren't reliably validated (confirmed
// empirically during Phase 2 planning -- garbage values didn't error), so `days`
// filtering happens client-side against every page rather than trusting an
// unconfirmed server-side filter.
export async function runBackfill(locationId: string, days: number): Promise<void> {
  const token = await resolveAccessToken(locationId);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let processed = 0;
  const toIngest: string[] = [];

  try {
    let page = 1;
    for (;;) {
      const response = await listCallLogs(token, locationId, { page, pageSize: PAGE_SIZE });

      for (const entry of response.callLogs) {
        if (new Date(entry.createdAt) >= cutoff) {
          toIngest.push(entry.id);
        }
      }

      if (response.callLogs.length < PAGE_SIZE || page * PAGE_SIZE >= response.total) break;
      page += 1;
    }

    await setProgress(locationId, { state: "running", processed: 0, total: toIngest.length });

    for (const ghlCallId of toIngest) {
      await ingestCall(locationId, ghlCallId);
      processed += 1;
      await setProgress(locationId, { state: "running", processed, total: toIngest.length });
    }

    await setProgress(locationId, { state: "completed", processed, total: toIngest.length });
  } catch (err) {
    await setProgress(locationId, { state: "failed", processed, total: toIngest.length });
    throw err;
  }
}
