import { upsertAgentFromGhl } from "../db/agents.js";
import { listAgents } from "../ghl/client.js";

// Agents otherwise only get created lazily as a side effect of ingestCall()
// encountering one of their calls (ingestCall.ts) -- a HighLevel agent with no
// calls yet (or none inside the backfill window) would never appear in this
// app at all without this. upsertAgentFromGhl is idempotent, so re-running this
// on every backfill just refreshes name/prompt/actions for agents already known.
//
// listAgents() only fetches a single page -- its pagination query param names
// were never confirmed against the real API (unlike listCallLogs', which BUILD
// SPEC's Phase 0 spike did verify), so this doesn't guess at them. Acceptable
// for this project's single-sandbox scope (BUILD_SPEC non-goal: multi-tenant
// scale hardening); revisit if a location ever has more agents than one page.
export async function syncAgentsForLocation(token: string, locationId: string): Promise<void> {
  const { agents } = await listAgents(token, locationId);
  for (const ghlAgent of agents) {
    await upsertAgentFromGhl(locationId, ghlAgent);
  }
}
