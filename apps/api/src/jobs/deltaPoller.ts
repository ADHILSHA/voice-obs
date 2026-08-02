import { prisma } from "../db/client.js";
import { callExists } from "../db/calls.js";
import { listCallLogs } from "../ghl/client.js";
import { resolveAccessToken } from "../ghl/tokens.js";
import { ingestCall } from "../ingest/ingestCall.js";

const PAGE_SIZE = 50;
const MAX_PAGES = 20; // safety bound, not a correctness dependency

// One global 60s tick polls every Installation, rather than a separate repeatable
// BullMQ job per installation -- simpler to schedule/manage at this project's
// single-sandbox scale, same practical effect.
export async function pollAllInstallations(): Promise<void> {
  const installations = await prisma.installation.findMany({ select: { locationId: true } });
  for (const installation of installations) {
    await pollInstallation(installation.locationId);
  }
}

// Pages call logs and ingests anything not already in the DB, checked by
// ghlCallId -- not by trusting listCallLogs' unconfirmed date-filter params
// (confirmed unreliable during Phase 2 planning). Stops once a page yields
// nothing new, since further (older) pages can only contain calls we've already
// seen on a prior cycle.
export async function pollInstallation(locationId: string): Promise<void> {
  const token = await resolveAccessToken(locationId);
  let newestSeen: Date | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await listCallLogs(token, locationId, { page, pageSize: PAGE_SIZE });

    let newInPage = 0;
    for (const entry of response.callLogs) {
      const exists = await callExists(locationId, entry.id);
      if (!exists) {
        await ingestCall(locationId, entry.id);
        newInPage += 1;
        const startedAt = new Date(entry.createdAt);
        if (!newestSeen || startedAt > newestSeen) newestSeen = startedAt;
      }
    }

    if (newInPage === 0) break;
    if (response.callLogs.length < PAGE_SIZE || page * PAGE_SIZE >= response.total) break;
  }

  await prisma.installation.update({
    where: { locationId },
    data: {
      lastSyncedAt: new Date(),
      ...(newestSeen ? { syncCursor: newestSeen } : {}),
    },
  });
}
