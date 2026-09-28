import { db } from "@/db";
import { candidates, candidatePersonalDetails, scores, decisions, emailDrafts, rubrics } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { rankCandidates, highestWeightCriterionKey, shortlistSize, type RankableScore } from "./rank";

export type CriterionResult = {
  criterion_key: string;
  score: number;
  evidence_quote: string;
  rationale: string;
  grounded: boolean;
};

export async function getRubricCriteria(role: "PM" | "SPM") {
  const [rubric] = await db
    .select()
    .from(rubrics)
    .where(and(eq(rubrics.role, role), eq(rubrics.isActive, true)));
  if (!rubric) return { version: 0, criteria: [] as { criterion_key: string; name: string; weight: number }[] };
  return { version: rubric.version, criteria: rubric.criteria as { criterion_key: string; name: string; weight: number }[] };
}

export async function getDashboardData(role: "PM" | "SPM") {
  const { criteria: rubricCriteria } = await getRubricCriteria(role);
  const topKey = highestWeightCriterionKey(rubricCriteria);
  const nameByKey = new Map(rubricCriteria.map((c) => [c.criterion_key, c.name]));

  const rows = await db
    .select({
      candidateId: candidates.id,
      status: candidates.status,
      createdAt: candidates.createdAt,
      firstOpenedAt: candidates.firstOpenedAt,
      weightedTotal: scores.weightedTotal,
      criteria: scores.criteria,
      flags: scores.flags,
      lowConfidence: scores.lowConfidence,
      fullName: candidatePersonalDetails.fullName,
    })
    .from(candidates)
    .innerJoin(scores, and(eq(scores.candidateId, candidates.id), eq(scores.role, role)))
    .innerJoin(candidatePersonalDetails, eq(candidatePersonalDetails.candidateId, candidates.id))
    .where(
      and(
        eq(candidates.appliedRole, role),
        eq(candidates.isCalibration, false),
        inArray(candidates.status, ["scored", "ready"]),
      ),
    );

  const rankable: RankableScore[] = rows.map((r) => ({
    candidateId: r.candidateId,
    weightedTotal: Number(r.weightedTotal),
    criteria: r.criteria as { criterion_key: string; score: number }[],
    createdAt: r.createdAt,
  }));
  const ranked = rankCandidates(rankable, topKey);
  const byId = new Map(rows.map((r) => [r.candidateId, r]));

  const N = shortlistSize();
  const shortlist = ranked.slice(0, N).map((r) => byId.get(r.candidateId)!);
  const belowTheLine = ranked.slice(N).map((r) => byId.get(r.candidateId)!);

  const needsReview = await db
    .select({
      candidateId: candidates.id,
      status: candidates.status,
      createdAt: candidates.createdAt,
    })
    .from(candidates)
    .where(
      and(
        eq(candidates.appliedRole, role),
        eq(candidates.isCalibration, false),
        inArray(candidates.status, ["needs_manual_review", "needs_identity_check", "failed"]),
      ),
    );

  const allForRole = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(eq(candidates.appliedRole, role), eq(candidates.isCalibration, false)));

  const decidedCount = await db
    .select({ candidateId: decisions.candidateId })
    .from(decisions)
    .innerJoin(candidates, eq(candidates.id, decisions.candidateId))
    .where(eq(candidates.appliedRole, role));

  const uniqueDecided = new Set(decidedCount.map((d) => d.candidateId)).size;

  const openTimes = rows.filter((r) => r.firstOpenedAt).map((r) => r.firstOpenedAt!.getTime() - r.createdAt.getTime());
  const medianReviewMs =
    openTimes.length > 0
      ? [...openTimes].sort((a, b) => a - b)[Math.floor(openTimes.length / 2)]
      : null;

  const draftsAwaiting = await db
    .select({ id: emailDrafts.id })
    .from(emailDrafts)
    .innerJoin(candidates, eq(candidates.id, emailDrafts.candidateId))
    .where(and(eq(candidates.appliedRole, role), eq(emailDrafts.status, "draft")));

  return {
    nameByKey,
    shortlist,
    belowTheLine,
    needsReview,
    metrics: {
      reviewedOf60: `${uniqueDecided} of ${allForRole.length}`,
      medianReviewMinutes: medianReviewMs !== null ? Math.round(medianReviewMs / 60000) : null,
      decisionsLogged: uniqueDecided,
      draftsAwaitingReview: draftsAwaiting.length,
    },
  };
}
