import { db } from "@/db";
import { candidates, decisions, emailDrafts } from "@/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";

export type DashboardMetrics = {
  reviewed: { opened: number; total: number };
  medianReviewMinutes: number | null;
  decisionsLogged: number;
  draftsAwaitingReview: number;
};

/** Median of a list of millisecond durations, rounded to whole minutes. Null for an empty list. */
export function medianReviewMinutes(durationsMs: number[]): number | null {
  if (durationsMs.length === 0) return null;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(medianMs / 60000);
}

/** Count of candidates whose scorecard has been opened at least once. */
export function countOpened(rows: { firstOpenedAt: Date | null }[]): number {
  return rows.filter((r) => r.firstOpenedAt !== null).length;
}

/**
 * The four metric-strip numbers, computed across BOTH roles together and
 * excluding every is_calibration candidate -- the strip is identical on the
 * PM and SPM tabs, unlike the shortlist/below-the-line lists which stay
 * per-role. Card 2 is "time from opening a profile to its first decision"
 * (not upload-to-open, and not decision-to-decision on a revised decision --
 * the *first* decision recorded for that candidate).
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const liveCandidates = await db
    .select({ id: candidates.id, firstOpenedAt: candidates.firstOpenedAt })
    .from(candidates)
    .where(eq(candidates.isCalibration, false));

  const reviewed = { opened: countOpened(liveCandidates), total: liveCandidates.length };

  const liveIds = liveCandidates.map((c) => c.id);
  const firstOpenedById = new Map(liveCandidates.map((c) => [c.id, c.firstOpenedAt]));

  const decisionRows =
    liveIds.length === 0
      ? []
      : await db
          .select({ candidateId: decisions.candidateId, decidedAt: decisions.decidedAt })
          .from(decisions)
          .where(inArray(decisions.candidateId, liveIds));

  const firstDecisionById = new Map<string, Date>();
  for (const d of decisionRows) {
    const existing = firstDecisionById.get(d.candidateId);
    if (!existing || d.decidedAt < existing) firstDecisionById.set(d.candidateId, d.decidedAt);
  }

  const durationsMs: number[] = [];
  for (const [candidateId, firstDecidedAt] of firstDecisionById) {
    const openedAt = firstOpenedById.get(candidateId);
    if (openedAt) durationsMs.push(firstDecidedAt.getTime() - openedAt.getTime());
  }

  const draftsAwaitingRows =
    liveIds.length === 0
      ? []
      : await db
          .select({ id: emailDrafts.id })
          .from(emailDrafts)
          .where(and(inArray(emailDrafts.candidateId, liveIds), ne(emailDrafts.status, "sent")));

  return {
    reviewed,
    medianReviewMinutes: medianReviewMinutes(durationsMs),
    decisionsLogged: decisionRows.length,
    draftsAwaitingReview: draftsAwaitingRows.length,
  };
}
