import { db } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * Metadata only, NEVER CV content -- see the audit_log column comment in
 * db/schema.ts. Callers must not pass cv_text_redacted, cv_content, or
 * anything derived verbatim from the CV into `meta`.
 */
export async function logAudit(params: {
  event: string;
  candidateId?: string;
  actor: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLog).values({
    event: params.event,
    candidateId: params.candidateId,
    actor: params.actor,
    meta: params.meta ?? {},
  });
}
