import { db } from "@/db";
import { candidates, candidatePersonalDetails, rubrics, scores, briefs, emailDrafts } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { rankCandidates, highestWeightCriterionKey, shortlistSize, type RankableScore } from "../rank";
import { generateBrief, type RubricCriterionWithProbe } from "../ai/brief";
import { generateEmailDraft } from "../ai/email";
import { logAudit } from "../audit";
import type { CriterionResult } from "../ai/score";

type SeededCriterion = RubricCriterionWithProbe & { weight: number };

async function activeRubricCriteria(role: "PM" | "SPM") {
  const [rubric] = await db
    .select()
    .from(rubrics)
    .where(and(eq(rubrics.role, role), eq(rubrics.isActive, true)));
  if (!rubric) throw new Error(`no active rubric for role ${role}`);
  return { version: rubric.version, criteria: rubric.criteria as SeededCriterion[] };
}

function contentSummary(cvContent: { roles: { title: string; employer: string }[]; skills: string[] }) {
  const roles = cvContent.roles.map((r) => `${r.title} at ${r.employer}`).join("; ");
  return `Roles: ${roles}\nSkills: ${cvContent.skills.slice(0, 12).join(", ")}`;
}

async function ensureDraft(params: {
  candidateId: string;
  desiredKind: "invite" | "rejection";
  role: "PM" | "SPM";
  cvContent: { roles: { title: string; employer: string }[]; skills: string[] };
  identity: { fullName: string; email: string | null; phone: string | null };
}) {
  const { candidateId, desiredKind, role, cvContent, identity } = params;

  const existing = await db.select().from(emailDrafts).where(eq(emailDrafts.candidateId, candidateId));
  const matching = existing.find((d) => d.kind === desiredKind);
  if (matching) return; // already have a draft of the right kind; never regenerate blindly.

  const stale = existing.find((d) => d.kind !== desiredKind && d.status !== "sent");
  if (stale) {
    await db.delete(emailDrafts).where(eq(emailDrafts.id, stale.id));
  }

  const draft = await generateEmailDraft({
    kind: desiredKind,
    role,
    contentSummary: contentSummary(cvContent),
    identity,
  });

  await db.insert(emailDrafts).values({
    candidateId,
    kind: desiredKind,
    subject: draft.subject,
    bodyTemplate: draft.body,
    source: draft.source,
    status: "draft",
  });

  await logAudit({ event: "draft.generated", candidateId, actor: "system", meta: { kind: desiredKind, source: draft.source } });
}

async function ensureBrief(params: {
  candidateId: string;
  criteria: CriterionResult[];
  rubricCriteria: SeededCriterion[];
  cvContent: { roles: { title: string; employer: string }[] };
  identity: { fullName: string; email: string | null; phone: string | null };
}) {
  const { candidateId, criteria, rubricCriteria, cvContent, identity } = params;
  const [existing] = await db.select().from(briefs).where(eq(briefs.candidateId, candidateId));
  if (existing) return;

  const result = await generateBrief({
    criteria,
    rubricCriteria,
    extraction: cvContent,
    identity,
  });

  await db.insert(briefs).values({
    candidateId,
    who: result.who,
    why: result.why,
    probe: result.probe,
    probes: result.probes,
    model: process.env.GEMINI_MODEL!,
  });

  await logAudit({ event: "brief.generated", candidateId, actor: "system", meta: { source: result.source } });
}

/**
 * Recomputes ranks and generates any missing briefs/drafts. Runs for both
 * roles. Auto-run when the upload queue drains, and callable directly as
 * POST /api/finalize.
 */
export async function runFinalizeStage(): Promise<{ processed: number }> {
  let processed = 0;

  for (const role of ["PM", "SPM"] as const) {
    const { criteria: rubricCriteria } = await activeRubricCriteria(role);
    const topKey = highestWeightCriterionKey(rubricCriteria);

    const rows = await db
      .select({
        candidateId: candidates.id,
        status: candidates.status,
        createdAt: candidates.createdAt,
        cvContent: candidates.cvContent,
        weightedTotal: scores.weightedTotal,
        criteria: scores.criteria,
        fullName: candidatePersonalDetails.fullName,
        email: candidatePersonalDetails.email,
        phone: candidatePersonalDetails.phone,
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
    const shortlistIds = new Set(ranked.slice(0, shortlistSize()).map((r) => r.candidateId));

    for (const row of rows) {
      const desiredKind: "invite" | "rejection" = shortlistIds.has(row.candidateId) ? "invite" : "rejection";
      const cvContent = row.cvContent as { roles: { title: string; employer: string }[]; skills: string[] };
      const identity = { fullName: row.fullName, email: row.email, phone: row.phone };

      if (desiredKind === "invite") {
        await ensureBrief({
          candidateId: row.candidateId,
          criteria: row.criteria as CriterionResult[],
          rubricCriteria,
          cvContent,
          identity,
        });
      }

      await ensureDraft({ candidateId: row.candidateId, desiredKind, role, cvContent, identity });

      if (row.status === "scored") {
        await db.update(candidates).set({ status: "ready" }).where(eq(candidates.id, row.candidateId));
      }
      processed++;
    }
  }

  return { processed };
}

/** Whether a scored candidate currently sits in the algorithmic shortlist for their applied role. */
export async function isCandidateShortlisted(candidateId: string): Promise<boolean> {
  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) return false;
  const role = candidate.appliedRole;

  const { criteria: rubricCriteria } = await activeRubricCriteria(role);
  const topKey = highestWeightCriterionKey(rubricCriteria);

  const rows = await db
    .select({
      candidateId: candidates.id,
      createdAt: candidates.createdAt,
      weightedTotal: scores.weightedTotal,
      criteria: scores.criteria,
    })
    .from(candidates)
    .innerJoin(scores, and(eq(scores.candidateId, candidates.id), eq(scores.role, role)))
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
  const shortlistIds = new Set(ranked.slice(0, shortlistSize()).map((r) => r.candidateId));
  return shortlistIds.has(candidateId);
}

/** Any candidate Arjun promotes below the algorithmic cutoff gets a brief and invite generated on demand. */
export async function promoteCandidate(candidateId: string): Promise<void> {
  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) throw new Error("candidate not found");
  const [details] = await db
    .select()
    .from(candidatePersonalDetails)
    .where(eq(candidatePersonalDetails.candidateId, candidateId));
  if (!details) throw new Error("candidate has no personal details");

  const [scoreRow] = await db
    .select()
    .from(scores)
    .where(and(eq(scores.candidateId, candidateId), eq(scores.role, candidate.appliedRole)));
  if (!scoreRow) throw new Error("candidate has no score for their applied role");

  const { criteria: rubricCriteria } = await activeRubricCriteria(candidate.appliedRole);
  const cvContent = candidate.cvContent as { roles: { title: string; employer: string }[]; skills: string[] };
  const identity = { fullName: details.fullName, email: details.email, phone: details.phone };

  await ensureBrief({
    candidateId,
    criteria: scoreRow.criteria as CriterionResult[],
    rubricCriteria,
    cvContent,
    identity,
  });
  await ensureDraft({ candidateId, desiredKind: "invite", role: candidate.appliedRole, cvContent, identity });
  await logAudit({ event: "candidate.promoted", candidateId, actor: "arjun" });
}
