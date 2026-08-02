import { Verdict } from "../../generated/prisma/client.js";

const VERDICT_VALUES: Record<Verdict, number | null> = {
  [Verdict.PASS]: 1,
  [Verdict.PARTIAL]: 0.5,
  [Verdict.FAIL]: 0,
  [Verdict.NOT_APPLICABLE]: null, // excluded from both numerator and denominator
};

export interface ScoredCriterionResult {
  verdict: Verdict;
  weight: number;
}

// sum(weight * verdictValue) / sum(weight) over applicable criteria only (§6.3).
export function computeCallHealthScore(results: ScoredCriterionResult[]): number | null {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const result of results) {
    const value = VERDICT_VALUES[result.verdict];
    if (value === null) continue; // not_applicable
    weightedSum += result.weight * value;
    totalWeight += result.weight;
  }

  return totalWeight === 0 ? null : weightedSum / totalWeight;
}

export interface HealthScoreSample {
  healthScore: number;
  createdAt: Date;
}

// Agent health = mean of each call's health score over a rolling 7-day window (§6.3).
export function computeAgentHealthScore(samples: HealthScoreSample[]): number | null {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = samples.filter((sample) => sample.createdAt >= cutoff);
  if (recent.length === 0) return null;
  return recent.reduce((sum, sample) => sum + sample.healthScore, 0) / recent.length;
}
