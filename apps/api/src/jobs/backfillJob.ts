import { listCallLogs } from "../ghl/client.js";
import { resolveAccessToken } from "../ghl/tokens.js";
import { ingestCall } from "../ingest/ingestCall.js";
import { syncAgentsForLocation } from "../ingest/syncAgents.js";
import { redis } from "../lib/redis.js";

const PAGE_SIZE = 50;

export interface BackfillStatus {
  state: "running" | "completed" | "failed";
  processed: number;
  total: number;
  error?: string;
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
  let processed = 0;
  const toIngest: string[] = [];

  // Written before anything that can fail (including token resolution) --
  // otherwise a failure that happens before the first setProgress call (e.g.
  // no Installation for this location yet) leaves the progress key unset, and
  // /api/sync/status silently reports the default "idle" forever instead of
  // surfacing that the job actually ran and failed.
  await setProgress(locationId, { state: "running", processed: 0, total: 0 });

  try {
    const token = await resolveAccessToken(locationId);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Runs before call-log paging so an agent with zero calls yet still shows
    // up after backfill, not just agents that happen to have call history.
    await syncAgentsForLocation(token, locationId);

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
    const message = err instanceof Error ? err.message : String(err);
    await setProgress(locationId, { state: "failed", processed, total: toIngest.length, error: message });
    throw err;
  }
}
