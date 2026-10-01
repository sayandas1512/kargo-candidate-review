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
  // Re-bind as definitely-typed locals -- TS doesn't carry the narrowing
  // from the guards above through into the nested closure below.
  const geminiModel: string = model;
  const redactedText: string = candidate.cvTextRedacted;
  const content = cvContent;

  // PM and SPM scoring are fully independent (different rubric, no shared
  // mutable state) -- running them concurrently instead of sequentially
  // roughly halves this stage's latency on top of the pass1/pass2
  // parallelization inside scoreCandidateAgainstRubric. If one role fails,
  // the other's result (if it succeeded) is still persisted -- status only
  // advances to "scored" once both have completed without throwing, so a
  // retry behaves exactly as before (whichever role already has a row is a
  // cheap onConflictDoUpdate, not wasted work).
  async function scoreOneRole(role: "PM" | "SPM"): Promise<void> {
    const started = Date.now();
    try {
      const { version, criteria } = await getActiveRubric(role);

      const result = await scoreCandidateAgainstRubric({
        criteria,
        doNotReward: criteria[0]?.do_not_reward ?? [],
        doNotPenalise: criteria[0]?.do_not_penalise ?? [],
        scorerInput,
        redactedText,
        identity,
        model: geminiModel,
        passes,
      });

      const flags = [...result.flags];
      const notMumbai = !content.location_stated || !/mumbai/i.test(content.location_stated);
      if (notMumbai && !content.relocation_stated) {
        flags.push("location_not_mumbai_no_relocation");
      }
      if (isExperienceOutsideRange(content.total_years_experience, role)) {
        flags.push("experience_years_outside_range");
      }

      await db
        .insert(scores)
        .values({
          candidateId,
          role,
          rubricVersion: version,
          model: geminiModel,
          criteria: result.criteria,
          weightedTotal: result.weightedTotal.toString(),
          flags,
          // Only the model-side signals (ungrounded_evidence, unstable_score,
          // possible_prompt_injection) drive low confidence. location/
          // experience-range flags are informational only, per spec never
          // used to score, exclude, or otherwise treat a candidate
          // differently -- they must not silently flip this either.
          lowConfidence: result.lowConfidence,
        })
        .onConflictDoUpdate({
          target: [scores.candidateId, scores.role, scores.rubricVersion],
          set: {
            model: geminiModel,
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
        meta: { stage: "score", role, model: geminiModel, durationMs: Date.now() - started, ok: true, weightedTotal: result.weightedTotal },
      });
    } catch (err) {
      await logAudit({
        event: "score.failed",
        candidateId,
        actor: "system",
        meta: { stage: "score", role, model: geminiModel, durationMs: Date.now() - started, ok: false, error: String(err) },
      });
      throw err;
    }
  }

  await Promise.all((["PM", "SPM"] as const).map(scoreOneRole));

  await db.update(candidates).set({ status: "scored" }).where(eq(candidates.id, candidateId));
}
