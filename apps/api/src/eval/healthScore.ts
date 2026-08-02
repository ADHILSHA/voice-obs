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

// One value per day (oldest first), averaging same-day samples, null for days
// with no data -- feeds the Overview agent card's sparkline (hand-rolled SVG,
// not a chart library, per BUILD_SPEC §3).
export function computeDailySparkline(samples: HealthScoreSample[], days = 7): (number | null)[] {
  const buckets: number[][] = Array.from({ length: days }, () => []);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const sample of samples) {
    const sampleDayStart = new Date(
      sample.createdAt.getFullYear(),
      sample.createdAt.getMonth(),
      sample.createdAt.getDate(),
    );
    const diffDays = Math.round((todayStart.getTime() - sampleDayStart.getTime()) / (24 * 60 * 60 * 1000));
    const bucketIdx = days - 1 - diffDays;
    if (bucketIdx >= 0 && bucketIdx < days) {
      buckets[bucketIdx].push(sample.healthScore);
    }
  }

  return buckets.map((bucket) =>
    bucket.length === 0 ? null : bucket.reduce((sum, value) => sum + value, 0) / bucket.length,
  );
}
