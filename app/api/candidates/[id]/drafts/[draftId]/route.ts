import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailDrafts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { validateEmailDraft } from "@/lib/validators";
import { logAudit } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; draftId: string }> }) {
  const { id, draftId } = await params;
  const body = await req.json().catch(() => null);
  const subject = typeof body?.subject === "string" ? body.subject : null;
  const bodyTemplate = typeof body?.body === "string" ? body.body : null;
  if (subject === null || bodyTemplate === null) {
    return NextResponse.json({ error: "subject and body are required" }, { status: 400 });
  }

  const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftId));
  if (!draft || draft.candidateId !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (draft.status === "sent") {
    return NextResponse.json({ error: "a sent draft can never be edited" }, { status: 409 });
  }

  const validation = validateEmailDraft({ subject, body: bodyTemplate }, draft.kind);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 422 });
  }

  await db
    .update(emailDrafts)
    .set({ subject, bodyTemplate, source: "edited", status: "draft", error: null })
    .where(eq(emailDrafts.id, draftId));

  await logAudit({ event: "draft.edited", candidateId: id, actor: "arjun", meta: { draftId } });

  return NextResponse.json({ ok: true });
}
