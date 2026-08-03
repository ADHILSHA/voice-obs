import { TurnRole } from "../../generated/prisma/client.js";
import type { Call, Turn } from "../../generated/prisma/client.js";

export interface DeterministicMetrics {
  talkRatioAgent: number;
  turnCount: number;
  reAskCount: number;
  deadAirMaxMs: number | null;
  actionFired: Record<string, boolean>;
  endedAbruptly: boolean;
  callerAskedForHuman: boolean;
}

// Hand-rolled Levenshtein distance -- ~20 lines, not worth a dependency for it.
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    const row: number[] = [i];
    matrix.push(row);
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

function normalizedSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function computeTalkRatioAgent(turns: Turn[]): number {
  const agentChars = turns
    .filter((t) => t.role === TurnRole.AGENT)
    .reduce((sum, t) => sum + t.text.length, 0);
  const totalChars = turns.reduce((sum, t) => sum + t.text.length, 0);
  return totalChars === 0 ? 0 : agentChars / totalChars;
}

// Agent turns >0.85 normalized-similarity to an earlier agent turn.
function computeReAskCount(turns: Turn[]): number {
  const agentTurns = turns.filter((t) => t.role === TurnRole.AGENT);
  let count = 0;
  for (let i = 1; i < agentTurns.length; i++) {
    for (let j = 0; j < i; j++) {
      if (normalizedSimilarity(agentTurns[i].text, agentTurns[j].text) > 0.85) {
        count++;
        break;
      }
    }
  }
  return count;
}

// No per-turn timestamps exist anywhere in this API (confirmed against real
// captured payloads), so this is always null in practice. Computed for real
// rather than hardcoded so it starts working the moment a data source with
// timestamps exists.
function computeDeadAirMaxMs(turns: Turn[]): number | null {
  const withTiming = turns.filter((t): t is Turn & { startMs: number } => t.startMs !== null);
  if (withTiming.length < 2) return null;

  let maxGap = 0;
  for (let i = 1; i < withTiming.length; i++) {
    const gap = withTiming[i].startMs - withTiming[i - 1].startMs;
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

const TERMINAL_PUNCTUATION = /[.!?]\s*$/;
const CONFIGURED_ABRUPT_REASONS = new Set(["failed", "no-answer", "error"]);

// endedReason has no source field in the API at all (confirmed) -- this is
// effectively transcript-heuristic-only today, kept structurally in case a
// future call type surfaces a real endedReason.
function computeEndedAbruptly(turns: Turn[], call: Call): boolean {
  if (call.endedReason && CONFIGURED_ABRUPT_REASONS.has(call.endedReason)) return true;

  const lastTurn = turns.at(-1);
  if (!lastTurn) return false;
  return lastTurn.role === TurnRole.CALLER && !TERMINAL_PUNCTUATION.test(lastTurn.text.trim());
}

const HUMAN_REQUEST_PATTERNS = [
  /speak (to|with) (a )?(human|person|representative|agent|someone)/i,
  /real (person|human)/i,
  /talk to (a )?(human|person|representative)/i,
  /customer service/i,
  /human agent/i,
  /transfer me/i,
];

function computeCallerAskedForHuman(turns: Turn[]): boolean {
  return turns
    .filter((t) => t.role === TurnRole.CALLER)
    .some((t) => HUMAN_REQUEST_PATTERNS.some((pattern) => pattern.test(t.text)));
}

// Best-effort: both Agent.actions and Call.actionsTriggered are empty arrays on
// every real sample so far, so the actual matching shape (by id? by name?) is
// unconfirmed. Checks common candidate keys defensively rather than guessing one.
function getActionIdentifier(action: unknown): string | undefined {
  if (!action || typeof action !== "object") return undefined;
  const record = action as Record<string, unknown>;
  for (const key of ["id", "actionId", "name", "type"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function computeActionFired(configuredActions: unknown, actionsTriggered: unknown): Record<string, boolean> {
  const configured = Array.isArray(configuredActions) ? configuredActions : [];
  const triggered = Array.isArray(actionsTriggered) ? actionsTriggered : [];
  const triggeredIds = new Set(triggered.map(getActionIdentifier).filter((id): id is string => Boolean(id)));

  const result: Record<string, boolean> = {};
  for (const action of configured) {
    const id = getActionIdentifier(action);
    if (id) result[id] = triggeredIds.has(id);
  }
  return result;
}

export function computeDeterministicMetrics(
  call: Call,
  turns: Turn[],
  configuredActions: unknown,
): DeterministicMetrics {
  return {
    talkRatioAgent: computeTalkRatioAgent(turns),
    turnCount: turns.length,
    reAskCount: computeReAskCount(turns),
    deadAirMaxMs: computeDeadAirMaxMs(turns),
    actionFired: computeActionFired(configuredActions, call.actionsTriggered),
    endedAbruptly: computeEndedAbruptly(turns, call),
    callerAskedForHuman: computeCallerAskedForHuman(turns),
  };
}
