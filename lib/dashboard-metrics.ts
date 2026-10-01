import { db } from "@/db";
import { candidates, decisions, emailDrafts } from "@/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";

export type DashboardMetrics = {
  reviewed: { opened: number; total: number };
  decisionsLogged: number;
  draftsAwaitingReview: number;
};

/** Count of candidates whose scorecard has been opened at least once. */
export function countOpened(rows: { firstOpenedAt: Date | null }[]): number {
  return rows.filter((r) => r.firstOpenedAt !== null).length;
}

/**
 * The metric-strip numbers, computed across BOTH roles together and
 * excluding every is_calibration candidate -- the strip is identical on the
 * PM and SPM tabs, unlike the shortlist/below-the-line lists which stay
 * per-role.
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const liveCandidates = await db
    .select({ id: candidates.id, firstOpenedAt: candidates.firstOpenedAt })
    .from(candidates)
    .where(eq(candidates.isCalibration, false));

  const reviewed = { opened: countOpened(liveCandidates), total: liveCandidates.length };

  const liveIds = liveCandidates.map((c) => c.id);

  const decisionRows =
    liveIds.length === 0
      ? []
      : await db
          .select({ candidateId: decisions.candidateId })
          .from(decisions)
          .where(inArray(decisions.candidateId, liveIds));

  const draftsAwaitingRows =
    liveIds.length === 0
      ? []
      : await db
          .select({ id: emailDrafts.id })
          .from(emailDrafts)
          .where(and(inArray(emailDrafts.candidateId, liveIds), ne(emailDrafts.status, "sent")));

  return {
    reviewed,
    decisionsLogged: decisionRows.length,
    draftsAwaitingReview: draftsAwaitingRows.length,
  };
}
