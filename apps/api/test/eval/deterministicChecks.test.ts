import { describe, expect, it } from "vitest";
import { TurnRole } from "../../generated/prisma/client.js";
import type { Call, Turn } from "../../generated/prisma/client.js";
import { computeDeterministicMetrics } from "../../src/eval/deterministicChecks.js";

function makeTurn(idx: number, role: TurnRole, text: string, startMs: number | null = null): Turn {
  return { id: `t${idx}`, callId: "c1", idx, role, text, startMs } as Turn;
}

function makeCall(overrides: Partial<Call> = {}): Call {
  return { endedReason: null, actionsTriggered: [], ...overrides } as Call;
}

describe("computeDeterministicMetrics", () => {
  it("computes talkRatioAgent from character counts", () => {
    const turns = [makeTurn(0, TurnRole.AGENT, "12345"), makeTurn(1, TurnRole.CALLER, "12345")];
    expect(computeDeterministicMetrics(makeCall(), turns, []).talkRatioAgent).toBeCloseTo(0.5);
  });

  it("computes turnCount", () => {
    const turns = [makeTurn(0, TurnRole.AGENT, "hi"), makeTurn(1, TurnRole.CALLER, "hey")];
    expect(computeDeterministicMetrics(makeCall(), turns, []).turnCount).toBe(2);
  });

  it("counts a re-ask when an agent turn is >0.85 similar to an earlier agent turn", () => {
    const turns = [
      makeTurn(0, TurnRole.AGENT, "Can I get your phone number please?"),
      makeTurn(1, TurnRole.CALLER, "Sure, one sec."),
      makeTurn(2, TurnRole.AGENT, "Can I get your phone number please?"),
    ];
    expect(computeDeterministicMetrics(makeCall(), turns, []).reAskCount).toBe(1);
  });

  it("does not count dissimilar agent turns as a re-ask", () => {
    const turns = [
      makeTurn(0, TurnRole.AGENT, "What is your name?"),
      makeTurn(1, TurnRole.AGENT, "What time works for you?"),
    ];
    expect(computeDeterministicMetrics(makeCall(), turns, []).reAskCount).toBe(0);
  });

  it("deadAirMaxMs is null when no turn has a timestamp", () => {
    const turns = [makeTurn(0, TurnRole.AGENT, "hi"), makeTurn(1, TurnRole.CALLER, "hey")];
    expect(computeDeterministicMetrics(makeCall(), turns, []).deadAirMaxMs).toBeNull();
  });

  it("computes deadAirMaxMs when timestamps exist", () => {
    const turns = [
      makeTurn(0, TurnRole.AGENT, "hi", 0),
      makeTurn(1, TurnRole.CALLER, "hey", 500),
      makeTurn(2, TurnRole.AGENT, "there", 3000),
    ];
    expect(computeDeterministicMetrics(makeCall(), turns, []).deadAirMaxMs).toBe(2500);
  });

  it("flags endedAbruptly when the last turn is a caller turn with no terminal punctuation", () => {
    const turns = [makeTurn(0, TurnRole.AGENT, "Hello."), makeTurn(1, TurnRole.CALLER, "wait I need to")];
    expect(computeDeterministicMetrics(makeCall(), turns, []).endedAbruptly).toBe(true);
  });

  it("does not flag endedAbruptly when the last turn ends with terminal punctuation", () => {
    const turns = [makeTurn(0, TurnRole.AGENT, "Hello."), makeTurn(1, TurnRole.CALLER, "Thanks, bye!")];
    expect(computeDeterministicMetrics(makeCall(), turns, []).endedAbruptly).toBe(false);
  });

  it("does not flag endedAbruptly when the last turn is an agent turn", () => {
    const turns = [makeTurn(0, TurnRole.CALLER, "hi"), makeTurn(1, TurnRole.AGENT, "bye")];
    expect(computeDeterministicMetrics(makeCall(), turns, []).endedAbruptly).toBe(false);
  });

  it("detects callerAskedForHuman via the regex bank", () => {
    const turns = [makeTurn(0, TurnRole.CALLER, "Can I speak to a human please?")];
    expect(computeDeterministicMetrics(makeCall(), turns, []).callerAskedForHuman).toBe(true);
  });

  it("does not false-positive callerAskedForHuman on unrelated text", () => {
    const turns = [makeTurn(0, TurnRole.CALLER, "I'd like to book an appointment.")];
    expect(computeDeterministicMetrics(makeCall(), turns, []).callerAskedForHuman).toBe(false);
  });

  it("computes actionFired by matching configured actions against actionsTriggered", () => {
    const call = makeCall({ actionsTriggered: [{ id: "action-1" }] });
    const metrics = computeDeterministicMetrics(call, [], [{ id: "action-1" }, { id: "action-2" }]);
    expect(metrics.actionFired).toEqual({ "action-1": true, "action-2": false });
  });
});
