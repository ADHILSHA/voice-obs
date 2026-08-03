import { ActionReason, type CriterionCategory, type Severity, type Verdict } from "../../generated/prisma/client.js";
import { createActionItemIfMissing } from "../db/actions.js";

// The one trigger rule this project implements: a CRITICAL-severity FAIL means
// a human should look at the call. HUMAN_REQUESTED (an explicit ask for a
// person during the call) isn't detected anywhere yet -- nothing produces that
// ActionReason via this path, so it stays available for a future judge signal
// without a schema change.
const CATEGORY_TO_REASON: Record<CriterionCategory, ActionReason> = {
  COMPLIANCE: ActionReason.COMPLIANCE_MISS,
  KNOWLEDGE: ActionReason.KNOWLEDGE_GAP,
  GOAL: ActionReason.HIGH_INTENT_LOST,
  DATA_CAPTURE: ActionReason.HIGH_INTENT_LOST,
  CONTAINMENT: ActionReason.HIGH_INTENT_LOST,
  CONVERSATIONAL: ActionReason.HIGH_INTENT_LOST,
};

export interface ActionTriggerResult {
  criterionKey: string;
  verdict: Verdict;
}

export interface ActionTriggerCriterion {
  key: string;
  severity: Severity;
  category: CriterionCategory;
}

// Called from evaluateCall.ts right after persisting a fresh evaluation, and
// separately from scripts/backfill-action-items.ts against already-persisted
// results -- same function either way, so the trigger rule only lives in one
// place. One ActionItem per (call, reason), not per criterion -- several
// CRITICAL fails mapping to the same reason on one call shouldn't duplicate.
export async function checkForActionTriggers(
  callId: string,
  results: ActionTriggerResult[],
  criteria: ActionTriggerCriterion[],
): Promise<void> {
  const criterionByKey = new Map(criteria.map((c) => [c.key, c]));
  const reasonsTriggered = new Set<ActionReason>();

  for (const result of results) {
    if (result.verdict !== "FAIL") continue;
    const criterion = criterionByKey.get(result.criterionKey);
    if (criterion?.severity !== "CRITICAL") continue;
    reasonsTriggered.add(CATEGORY_TO_REASON[criterion.category]);
  }

  for (const reason of reasonsTriggered) {
    await createActionItemIfMissing(callId, reason, "CRITICAL");
  }
}
