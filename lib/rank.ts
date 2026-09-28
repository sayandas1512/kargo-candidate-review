export type RankableScore = {
  candidateId: string;
  weightedTotal: number;
  criteria: { criterion_key: string; score: number }[];
  createdAt: Date;
};

/**
 * Ranks scored candidates within the role they applied for. Code only -- the
 * model never ranks. Tie-break: total desc, then the highest-weight
 * criterion's score desc, then earliest upload time first.
 */
export function rankCandidates(
  rows: RankableScore[],
  highestWeightCriterionKey: string,
): RankableScore[] {
  return [...rows].sort((a, b) => {
    if (b.weightedTotal !== a.weightedTotal) return b.weightedTotal - a.weightedTotal;

    const aTop = a.criteria.find((c) => c.criterion_key === highestWeightCriterionKey)?.score ?? 0;
    const bTop = b.criteria.find((c) => c.criterion_key === highestWeightCriterionKey)?.score ?? 0;
    if (bTop !== aTop) return bTop - aTop;

    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

export function highestWeightCriterionKey(criteria: { criterion_key: string; weight: number }[]): string {
  return [...criteria].sort((a, b) => b.weight - a.weight)[0]?.criterion_key ?? "";
}

export function shortlistSize(): number {
  const raw = process.env.SHORTLIST_SIZE;
  const n = raw ? parseInt(raw, 10) : 5;
  return Number.isFinite(n) && n > 0 ? n : 5;
}
