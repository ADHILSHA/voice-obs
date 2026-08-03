import { TurnRole } from "../../generated/prisma/client.js";
import type { GhlCallLogEntry } from "../ghl/client.js";

export interface NormalizedTurn {
  idx: number;
  role: TurnRole;
  text: string;
  startMs: number | null;
}

export interface NormalizedCall {
  locationId: string;
  ghlCallId: string;
  agentGhlId: string;
  startedAt: Date;
  durationSec: number;
  direction: string | null;
  endedReason: string | null;
  actionsTriggered: unknown[];
  recordingUrl: string | null;
  contactRef: string | null;
  summary: string | null;
  extractedData: Record<string, unknown> | null;
  isTrialCall: boolean;
  isAgentDeleted: boolean;
  translation: unknown | null;
}

const SPEAKER_PREFIXES: { prefix: string; role: TurnRole }[] = [
  { prefix: "bot:", role: TurnRole.AGENT },
  { prefix: "human:", role: TurnRole.CALLER },
];

// Splits a flat "bot:...\nhuman:...\n" transcript into turns. A line that doesn't
// start with a recognized speaker prefix -- a blank line from a mid-sentence wrap,
// or interruption artifacts -- is folded into the previous turn's text rather than
// treated as a new turn or dropped. Confirmed necessary against a real captured
// transcript, not a hypothetical.
export function parseTranscript(transcript: string): { role: TurnRole; text: string }[] {
  const lines = transcript.split("\n");
  const turns: { role: TurnRole; text: string }[] = [];

  for (const line of lines) {
    const match = SPEAKER_PREFIXES.find((sp) => line.startsWith(sp.prefix));
    if (match) {
      turns.push({ role: match.role, text: line.slice(match.prefix.length).trim() });
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const previous = turns.at(-1);
    if (previous) {
      previous.text = `${previous.text} ${trimmed}`.trim();
    }
    // A continuation line with no prior turn (shouldn't happen in practice) is
    // silently dropped rather than invented as a fake turn.
  }

  return turns;
}

// Pure function: no DB or network access, so fixture tests can exercise it
// directly against a real captured payload (already Zod-validated by ghl/client.ts
// -- validation is centralized there, not duplicated here).
export function normalizeCall(
  raw: GhlCallLogEntry,
  locationId: string,
): { call: NormalizedCall; turns: NormalizedTurn[] } {
  const turns: NormalizedTurn[] = parseTranscript(raw.transcript).map((turn, idx) => ({
    idx,
    role: turn.role,
    text: turn.text,
    startMs: null, // no per-turn timing exists anywhere in this API
  }));

  const call: NormalizedCall = {
    locationId,
    ghlCallId: raw.id,
    agentGhlId: raw.agentId,
    startedAt: new Date(raw.createdAt),
    durationSec: raw.duration,
    direction: null, // no source field in the API at all
    endedReason: null, // no source field in the API at all
    actionsTriggered: raw.executedCallActions,
    recordingUrl: null, // confirmed absent (key missing, not null) on every sample so far
    contactRef: raw.contactId ?? null,
    summary: raw.summary ?? null,
    extractedData: raw.extractedData ?? null,
    isTrialCall: raw.trialCall ?? false,
    isAgentDeleted: raw.isAgentDeleted,
    translation: raw.translation ?? null,
  };

  return { call, turns };
}
