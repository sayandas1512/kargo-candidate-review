import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { db } from "@/db";
import { candidatePersonalDetails, emailDrafts } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { canSend } from "@/lib/canSend";
import { logAudit } from "@/lib/audit";
import { textToEmailHtml } from "@/lib/email-format";

export const maxDuration = 60;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bulk "Send N reviewed rejections". Only candidates that pass canSend are
 * eligible; low-confidence candidates are excluded from bulk send entirely
 * (they must be sent one at a time with the explicit acknowledgement).
 */
export async function POST(req: NextRequest) {
  // Off by default -- bulk send has no UI wired to it yet, and turning it on
  // is a deliberate operational decision, not something a deploy should
  // silently enable. Never set to "true" on Vercel without an explicit ask.
  if (process.env.BULK_SEND_ENABLED !== "true") {
    return NextResponse.json({ error: "bulk send is disabled" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const candidateIds: unknown = body?.candidateIds;
  const confirmation: unknown = body?.confirmation;

  if (!Array.isArray(candidateIds) || candidateIds.some((c) => typeof c !== "string")) {
    return NextResponse.json({ error: "candidateIds must be an array of strings" }, { status: 400 });
  }
  if (confirmation !== `SEND ${candidateIds.length}`) {
    return NextResponse.json({ error: `type "SEND ${candidateIds.length}" to confirm` }, { status: 400 });
  }

  const eligible: { candidateId: string; draftId: string }[] = [];
  const skipped: { candidateId: string; reasons: string[] }[] = [];

  for (const candidateId of candidateIds) {
    const gate = await canSend({ candidateId, kind: "rejection" });
    if (gate.allowed && gate.draftId) {
      eligible.push({ candidateId, draftId: gate.draftId });
    } else {
      skipped.push({ candidateId, reasons: gate.reasons });
    }
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const mode = (process.env.EMAIL_MODE as "test" | "live") ?? "test";
  const sent: string[] = [];
  const failed: { candidateId: string; error: string }[] = [];

  for (const { candidateId, draftId } of eligible) {
    const claimed = await db
      .update(emailDrafts)
      .set({ status: "sending" })
      .where(and(eq(emailDrafts.id, draftId), inArray(emailDrafts.status, ["draft", "failed"])))
      .returning();
    if (claimed.length === 0) continue;
    const draft = claimed[0];

    const [details] = await db.select().from(candidatePersonalDetails).where(eq(candidatePersonalDetails.candidateId, candidateId));
    const firstName = details?.fullName.split(/\s+/)[0] ?? "there";
    const personalizedBody = draft.bodyTemplate.replace("[NAME]", firstName);
    const isTest = mode !== "live";
    const to = isTest ? process.env.TEST_RECIPIENT_EMAIL : details?.email;
    const subject = isTest ? `[TEST for ${firstName}] ${draft.subject}` : draft.subject;

    if (!to) {
      await db.update(emailDrafts).set({ status: "failed", error: "no recipient" }).where(eq(emailDrafts.id, draft.id));
      failed.push({ candidateId, error: "no recipient" });
      continue;
    }

    try {
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
      await logAudit({ event: "email.sent", candidateId, actor: "arjun", meta: { draftId: draft.id, kind: "rejection", mode, resendId: data?.id, bulk: true } });
      sent.push(candidateId);
    } catch (err) {
      await db.update(emailDrafts).set({ status: "failed", error: String(err) }).where(eq(emailDrafts.id, draft.id));
      await logAudit({ event: "email.failed", candidateId, actor: "arjun", meta: { draftId: draft.id, kind: "rejection", mode, error: String(err), bulk: true } });
      failed.push({ candidateId, error: String(err) });
    }

    await sleep(600);
  }

  return NextResponse.json({ sent, failed, skipped });
}
