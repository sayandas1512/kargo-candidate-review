import { notFound } from "next/navigation";
import { db } from "@/db";
import { candidates, candidatePersonalDetails, scores, briefs, emailDrafts, decisions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getRubricCriteria } from "@/lib/dashboard";
import CandidateClient from "./CandidateClient";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, id));
  if (!candidate) notFound();

  const [details, scoreRows, [brief], draftRows, decisionRows] = await Promise.all([
    db.select().from(candidatePersonalDetails).where(eq(candidatePersonalDetails.candidateId, id)),
    db.select().from(scores).where(eq(scores.candidateId, id)),
    db.select().from(briefs).where(eq(briefs.candidateId, id)),
    db.select().from(emailDrafts).where(eq(emailDrafts.candidateId, id)),
    db.select().from(decisions).where(eq(decisions.candidateId, id)).orderBy(desc(decisions.decidedAt)),
  ]);

  const { criteria: pmCriteria } = await getRubricCriteria("PM");
  const { criteria: spmCriteria } = await getRubricCriteria("SPM");

  return (
    <CandidateClient
      candidate={{ ...candidate, createdAt: candidate.createdAt.toISOString(), firstOpenedAt: candidate.firstOpenedAt?.toISOString() ?? null }}
      details={details[0] ?? null}
      scores={scoreRows.map((s) => ({ ...s, createdAt: s.createdAt.toISOString(), weightedTotal: Number(s.weightedTotal) }))}
      brief={brief ?? null}
      drafts={draftRows.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), sentAt: d.sentAt?.toISOString() ?? null }))}
      decisions={decisionRows.map((d) => ({ ...d, decidedAt: d.decidedAt.toISOString() }))}
      rubricNames={{
        PM: Object.fromEntries(pmCriteria.map((c) => [c.criterion_key, c.name])),
        SPM: Object.fromEntries(spmCriteria.map((c) => [c.criterion_key, c.name])),
      }}
    />
  );
}
