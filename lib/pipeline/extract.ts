import { db } from "@/db";
import { candidates, candidatePersonalDetails } from "@/db/schema";
import { eq } from "drizzle-orm";
import { extractCV } from "../ai/extract";
import { computeTotalYearsExperience } from "../experience";
import { logAudit } from "../audit";

export async function runExtractStage(candidateId: string): Promise<void> {
  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) throw new Error("candidate not found");
  if (candidate.status !== "uploaded") {
    throw new Error(`candidate ${candidateId} is in status ${candidate.status}, expected 'uploaded'`);
  }
  if (!candidate.cvTextRedacted) throw new Error("candidate has no redacted CV text");

  const [details] = await db
    .select()
    .from(candidatePersonalDetails)
    .where(eq(candidatePersonalDetails.candidateId, candidateId));
  if (!details) throw new Error("candidate has no personal details record");

  const identity = { fullName: details.fullName, email: details.email, phone: details.phone };

  const started = Date.now();
  try {
    const extraction = await extractCV(candidate.cvTextRedacted, identity);
    const totalYearsExperience = computeTotalYearsExperience(extraction.roles);

    await db
      .update(candidates)
      .set({
        cvContent: { ...extraction, total_years_experience: totalYearsExperience },
        status: "extracted",
      })
      .where(eq(candidates.id, candidateId));

    await logAudit({
      event: "extract.ok",
      candidateId,
      actor: "system",
      meta: { stage: "extract", model: process.env.GEMINI_MODEL, durationMs: Date.now() - started, ok: true },
    });
  } catch (err) {
    await db.update(candidates).set({ status: "failed" }).where(eq(candidates.id, candidateId));
    await logAudit({
      event: "extract.failed",
      candidateId,
      actor: "system",
      meta: { stage: "extract", model: process.env.GEMINI_MODEL, durationMs: Date.now() - started, ok: false, error: String(err) },
    });
    throw err;
  }
}
