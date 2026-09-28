import { db } from "@/db";
import { candidates, candidatePersonalDetails, rubrics, scores } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { scoreCandidateAgainstRubric, type RubricCriterionForScoring, type ScorerInput } from "../ai/score";
import { isExperienceOutsideRange } from "../experience";
import { logAudit } from "../audit";

type SeededCriterion = RubricCriterionForScoring & {
  do_not_reward: string[];
  do_not_penalise: string[];
};

async function getActiveRubric(role: "PM" | "SPM") {
  const [rubric] = await db
    .select()
    .from(rubrics)
    .where(and(eq(rubrics.role, role), eq(rubrics.isActive, true)));
  if (!rubric) throw new Error(`no active rubric for role ${role}`);

  const criteria = rubric.criteria as SeededCriterion[];
  const weightSum = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (weightSum !== 100) {
    throw new Error(`Active ${role} rubric v${rubric.version} weights sum to ${weightSum}, not 100. Refusing to score.`);
  }
  return { version: rubric.version, criteria };
}

export async function runScoreStage(candidateId: string): Promise<void> {
  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) throw new Error("candidate not found");
  if (candidate.status !== "extracted") {
    throw new Error(`candidate ${candidateId} is in status ${candidate.status}, expected 'extracted'`);
  }
  const cvContent = candidate.cvContent as {
    roles: { title: string; employer: string; start: string; end: string; bullets: string[] }[];
    skills: string[];
    location_stated: string | null;
    relocation_stated: boolean | null;
    total_years_experience: number;
  } | null;
  if (!cvContent) throw new Error("candidate has no cv_content");

  const [details] = await db
    .select()
    .from(candidatePersonalDetails)
    .where(eq(candidatePersonalDetails.candidateId, candidateId));
  if (!details) throw new Error("candidate has no personal details record");
  if (!candidate.cvTextRedacted) throw new Error("candidate has no redacted CV text");

  const identity = { fullName: details.fullName, email: details.email, phone: details.phone };
  const scorerInput: ScorerInput = { roles: cvContent.roles, skills: cvContent.skills };
  const model = process.env.GEMINI_MODEL;
  if (!model) throw new Error("GEMINI_MODEL is not set");
  const passes = parseInt(process.env.SCORING_PASSES ?? "2", 10) || 2;

  for (const role of ["PM", "SPM"] as const) {
    const started = Date.now();
    try {
      const { version, criteria } = await getActiveRubric(role);

      const result = await scoreCandidateAgainstRubric({
        criteria,
        doNotReward: criteria[0]?.do_not_reward ?? [],
        doNotPenalise: criteria[0]?.do_not_penalise ?? [],
        scorerInput,
        redactedText: candidate.cvTextRedacted,
        identity,
        model,
        passes,
      });

      const flags = [...result.flags];
      const notMumbai = !cvContent.location_stated || !/mumbai/i.test(cvContent.location_stated);
      if (notMumbai && !cvContent.relocation_stated) {
        flags.push("location_not_mumbai_no_relocation");
      }
      if (isExperienceOutsideRange(cvContent.total_years_experience, role)) {
        flags.push("experience_years_outside_range");
      }

      await db
        .insert(scores)
        .values({
          candidateId,
          role,
          rubricVersion: version,
          model,
          criteria: result.criteria,
          weightedTotal: result.weightedTotal.toString(),
          flags,
          lowConfidence: result.lowConfidence || flags.length > result.flags.length,
        })
        .onConflictDoUpdate({
          target: [scores.candidateId, scores.role, scores.rubricVersion],
          set: {
            model,
            criteria: result.criteria,
            weightedTotal: result.weightedTotal.toString(),
            flags,
            lowConfidence: result.lowConfidence,
          },
        });

      await logAudit({
        event: "score.ok",
        candidateId,
        actor: "system",
        meta: { stage: "score", role, model, durationMs: Date.now() - started, ok: true, weightedTotal: result.weightedTotal },
      });
    } catch (err) {
      await logAudit({
        event: "score.failed",
        candidateId,
        actor: "system",
        meta: { stage: "score", role, model, durationMs: Date.now() - started, ok: false, error: String(err) },
      });
      throw err;
    }
  }

  await db.update(candidates).set({ status: "scored" }).where(eq(candidates.id, candidateId));
}
