/** Weighted total (0-100) = sum over criteria of: weight x (score / 4), rounded to 1 decimal. */
export function computeWeightedTotal(
  criteria: { criterion_key: string; weight: number }[],
  results: { criterion_key: string; score: number }[],
): number {
  const scoreByKey = new Map(results.map((r) => [r.criterion_key, r.score]));
  const total = criteria.reduce((sum, c) => sum + (c.weight * (scoreByKey.get(c.criterion_key) ?? 0)) / 4, 0);
  return Math.round(total * 10) / 10;
}
