import { db } from "@/db";
import { candidates, decisions, emailDrafts, scores } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { validateEmailDraft } from "./validators";
import { isCandidateShortlisted } from "./pipeline/finalize";

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
  /** Explicit human override for condition 8 (placement contradicts draft kind). */
  placementConfirmed?: boolean;
}): Promise<CanSendResult> {
  const { candidateId, kind, acknowledgedLowConfidence, liveConfirmed, placementConfirmed } = params;
  const reasons: string[] = [];

  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!candidate) {
    return { allowed: false, reasons: ["candidate not found"] };
  }

  // A calibration/test fixture is never a real applicant -- never sendable,
  // full stop, regardless of how its decision/draft/status otherwise look.
  if (candidate.isCalibration) {
    reasons.push("candidate is a calibration/test fixture, never sendable");
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

  // 8. The draft kind must still match the candidate's CURRENT algorithmic
  // placement, not just their decision. A decision can correctly match the
  // draft kind at decide-time and then drift out of sync -- e.g. more
  // candidates get scored afterward and the shortlist cutoff moves -- with
  // nothing else catching it, since finalize deliberately never overwrites a
  // decision-driven draft (see lib/pipeline/finalize.ts). Only checked once
  // everything else already passes, both to avoid the extra query on an
  // already-blocked send and to keep this additive for every existing
  // caller/test that only cares about the other 7 conditions.
  if (reasons.length === 0 && draft) {
    const shortlisted = await isCandidateShortlisted(candidateId);
    const contradicts = (kind === "rejection" && shortlisted) || (kind === "invite" && !shortlisted);
    if (contradicts && !placementConfirmed) {
      reasons.push(
        kind === "rejection"
          ? "candidate is currently shortlisted by the algorithm; sending a rejection needs explicit confirmation"
          : "candidate is currently below the shortlist cutoff; sending an invite needs explicit confirmation",
      );
    }
  }

  return { allowed: reasons.length === 0, reasons, draftId: draft?.id };
}
