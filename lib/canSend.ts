import { db } from "@/db";
import { candidates, decisions, emailDrafts, scores } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { validateEmailDraft } from "./validators";

export type CanSendResult = {
  allowed: boolean;
  reasons: string[];
  draftId?: string;
};

/**
 * The ONE gate for sending an email. Every reason for a "no" is returned so
 * the UI can show "Why is Send disabled?" listing every unmet condition.
 * Condition 1 (authenticated session) is enforced by middleware before any
 * route reaches this function, so it is not re-checked here.
 */
export async function canSend(params: {
  candidateId: string;
  kind: "invite" | "rejection";
  acknowledgedLowConfidence?: boolean;
  liveConfirmed?: boolean;
}): Promise<CanSendResult> {
  const { candidateId, kind, acknowledgedLowConfidence, liveConfirmed } = params;
  const reasons: string[] = [];

  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) {
    return { allowed: false, reasons: ["candidate not found"] };
  }

  // 2. Status must not be a holding/failed state.
  if (["needs_manual_review", "needs_identity_check", "failed"].includes(candidate.status)) {
    reasons.push(`candidate status is ${candidate.status}`);
  }

  // 3. Scorecard must have been opened (recorded server-side).
  if (!candidate.firstOpenedAt) {
    reasons.push("scorecard has not been opened yet");
  }

  // 4. Latest decision must match the draft kind. hold never sends.
  const [latestDecision] = await db
    .select()
    .from(decisions)
    .where(eq(decisions.candidateId, candidateId))
    .orderBy(desc(decisions.decidedAt))
    .limit(1);

  if (!latestDecision) {
    reasons.push("no decision recorded yet");
  } else if (latestDecision.decision === "hold") {
    reasons.push("latest decision is hold; hold never sends");
  } else if (latestDecision.decision === "advance" && kind !== "invite") {
    reasons.push("latest decision is advance, which requires an invite draft, not rejection");
  } else if (latestDecision.decision === "decline" && kind !== "rejection") {
    reasons.push("latest decision is decline, which requires a rejection draft, not invite");
  }

  // 5. Draft must exist, pass validation, and not already be sent.
  const [draft] = await db
    .select()
    .from(emailDrafts)
    .where(and(eq(emailDrafts.candidateId, candidateId), eq(emailDrafts.kind, kind)))
    .orderBy(desc(emailDrafts.createdAt))
    .limit(1);

  if (!draft) {
    reasons.push(`no ${kind} draft exists`);
  } else {
    if (draft.status === "sent") {
      reasons.push("draft has already been sent");
    }
    if (draft.status === "sending") {
      reasons.push("draft is currently being sent");
    }
    const validation = validateEmailDraft({ subject: draft.subject, body: draft.bodyTemplate }, kind);
    if (!validation.ok) {
      reasons.push(`draft fails validation: ${validation.reason}`);
    }
  }

  // 6. Rejection to a low-confidence candidate needs an explicit acknowledgement.
  if (kind === "rejection") {
    const [scoreRow] = await db
      .select()
      .from(scores)
      .where(and(eq(scores.candidateId, candidateId), eq(scores.role, candidate.appliedRole)))
      .orderBy(desc(scores.createdAt))
      .limit(1);
    if (scoreRow?.lowConfidence && !acknowledgedLowConfidence) {
      reasons.push("candidate is low-confidence; requires the 'I've read the flags' acknowledgement");
    }
  }

  // 7. Live mode requires explicit confirmation of the recipient count.
  const emailMode = process.env.EMAIL_MODE ?? "test";
  if (emailMode === "live" && !liveConfirmed) {
    reasons.push("EMAIL_MODE=live requires confirming the recipient count before sending");
  }

  return { allowed: reasons.length === 0, reasons, draftId: draft?.id };
}
