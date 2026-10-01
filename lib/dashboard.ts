import { db } from "@/db";
import { candidates, candidatePersonalDetails, scores, emailDrafts, rubrics } from "@/db/schema";
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

  const draftRows = await db
    .select({
      candidateId: emailDrafts.candidateId,
      kind: emailDrafts.kind,
      status: emailDrafts.status,
      sentTo: emailDrafts.sentTo,
      sentAt: emailDrafts.sentAt,
      createdAt: emailDrafts.createdAt,
    })
    .from(emailDrafts)
    .innerJoin(candidates, eq(candidates.id, emailDrafts.candidateId))
    .where(and(eq(candidates.appliedRole, role), eq(candidates.isCalibration, false)));

  // A candidate can end up with more than one draft over time (e.g. a sent
  // invite plus a later rejection after demoteCandidate) -- the dashboard
  // only cares about the most recent one.
  const latestDraftByCandidate = new Map<string, (typeof draftRows)[number]>();
  for (const d of draftRows) {
    const existing = latestDraftByCandidate.get(d.candidateId);
    if (!existing || d.createdAt > existing.createdAt) latestDraftByCandidate.set(d.candidateId, d);
  }

  const byId = new Map(
    rows.map((r) => [r.candidateId, { ...r, latestDraft: latestDraftByCandidate.get(r.candidateId) ?? null }]),
  );

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

  return {
    nameByKey,
    shortlist,
    belowTheLine,
    needsReview,
  };
}
