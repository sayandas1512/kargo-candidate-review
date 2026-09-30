/** Below this weightedTotal (0-100 scale), a score is flagged low-confidence purely for being weak -- independent of whether the model grounded its evidence cleanly. */
export const LOW_SCORE_THRESHOLD = 50;

/** At or above this weightedTotal, a score is flagged high-confidence -- mirrors LOW_SCORE_THRESHOLD, and only applies when the score isn't already low-confidence for a grounding reason. */
export const HIGH_SCORE_THRESHOLD = 70;

export function isHighConfidence(weightedTotal: number, lowConfidence: boolean): boolean {
  return !lowConfidence && weightedTotal >= HIGH_SCORE_THRESHOLD;
}

/** Weighted total (0-100) = sum over criteria of: weight x (score / 4), rounded to 1 decimal. */
export function computeWeightedTotal(
  criteria: { criterion_key: string; weight: number }[],
  results: { criterion_key: string; score: number }[],
): number {
  const scoreByKey = new Map(results.map((r) => [r.criterion_key, r.score]));
  const total = criteria.reduce((sum, c) => sum + (c.weight * (scoreByKey.get(c.criterion_key) ?? 0)) / 4, 0);
  return Math.round(total * 10) / 10;
}
