import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "@/db";
import { candidatePersonalDetails, emailDrafts } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { canSend } from "@/lib/canSend";
import { logAudit } from "@/lib/audit";
import { textToEmailHtml } from "@/lib/email-format";

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind;
  if (kind !== "invite" && kind !== "rejection") {
    return NextResponse.json({ error: "kind must be invite or rejection" }, { status: 400 });
  }

  const gate = await canSend({
    candidateId: id,
    kind,
    acknowledgedLowConfidence: body?.acknowledgedLowConfidence === true,
    liveConfirmed: body?.liveConfirmed === true,
  });
  if (!gate.allowed || !gate.draftId) {
    return NextResponse.json({ error: "send is not allowed", reasons: gate.reasons }, { status: 409 });
  }

  // Idempotent claim: only the request that flips draft.status wins.
  const claimed = await db
    .update(emailDrafts)
    .set({ status: "sending" })
    .where(and(eq(emailDrafts.id, gate.draftId), inArray(emailDrafts.status, ["draft", "failed"])))
    .returning();

  if (claimed.length === 0) {
    return NextResponse.json({ error: "draft is already being sent or was already sent" }, { status: 409 });
  }
  const draft = claimed[0];

  const [details] = await db.select().from(candidatePersonalDetails).where(eq(candidatePersonalDetails.candidateId, id));
  if (!details?.email) {
    await db.update(emailDrafts).set({ status: "failed", error: "candidate has no email on file" }).where(eq(emailDrafts.id, draft.id));
    return NextResponse.json({ error: "candidate has no email on file" }, { status: 422 });
  }

  const mode = (process.env.EMAIL_MODE as "test" | "live") ?? "test";
  const firstName = details.fullName.split(/\s+/)[0];
  const personalizedBody = draft.bodyTemplate.replace("[NAME]", firstName);

  const isTest = mode !== "live";
  const to = isTest ? process.env.TEST_RECIPIENT_EMAIL : details.email;
  const subject = isTest ? `[TEST for ${firstName}] ${draft.subject}` : draft.subject;

  if (!to) {
    await db.update(emailDrafts).set({ status: "failed", error: "no recipient configured" }).where(eq(emailDrafts.id, draft.id));
    return NextResponse.json({ error: "no recipient configured (TEST_RECIPIENT_EMAIL unset in test mode)" }, { status: 500 });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM ?? "onboarding@resend.dev",
      to,
      subject,
      text: personalizedBody,
      html: textToEmailHtml(personalizedBody),
    });

    if (error) throw new Error(error.message);

    await db
      .update(emailDrafts)
      .set({ status: "sent", resendId: data?.id, sentTo: to, sentAt: new Date(), mode, error: null })
      .where(eq(emailDrafts.id, draft.id));

    await logAudit({
      event: "email.sent",
      candidateId: id,
      actor: "arjun",
      meta: { draftId: draft.id, kind, mode, resendId: data?.id },
    });

    return NextResponse.json({ ok: true, resendId: data?.id });
  } catch (err) {
    await db.update(emailDrafts).set({ status: "failed", error: String(err) }).where(eq(emailDrafts.id, draft.id));
    await logAudit({ event: "email.failed", candidateId: id, actor: "arjun", meta: { draftId: draft.id, kind, mode, error: String(err) } });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
