import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { candidates, candidatePersonalDetails, scores, briefs, emailDrafts, decisions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, id));
  if (!candidate) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [details, scoreRows, [brief], draftRows, decisionRows] = await Promise.all([
    db.select().from(candidatePersonalDetails).where(eq(candidatePersonalDetails.candidateId, id)),
    db.select().from(scores).where(eq(scores.candidateId, id)),
    db.select().from(briefs).where(eq(briefs.candidateId, id)),
    db.select().from(emailDrafts).where(eq(emailDrafts.candidateId, id)),
    db.select().from(decisions).where(eq(decisions.candidateId, id)).orderBy(desc(decisions.decidedAt)),
  ]);

  return NextResponse.json({
    candidate,
    personalDetails: details[0] ?? null,
    scores: scoreRows,
    brief: brief ?? null,
    drafts: draftRows,
    decisions: decisionRows,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.execute(sql`select delete_candidate(${id}::uuid)`);
  // Deliberately no candidateId here: the row (and its own audit trail) is
  // gone via cascade, and audit_log.candidate_id has an FK that would reject
  // a reference to a candidate that no longer exists. The id lives in meta.
  await logAudit({ event: "candidate.deleted", actor: "arjun", meta: { deletedCandidateId: id } });
  return NextResponse.json({ ok: true });
}
