import { db } from "@/db";
import { candidates, candidateFiles, candidatePersonalDetails } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ingestFile, hashBytes } from "../ingest";
import { extractPII, guessNameFromCV, redactCV, leakCheck, isPlausibleName } from "../pii-guard";
import { logAudit } from "../audit";

export type IngestOutcome =
  | { status: "duplicate"; candidateId: string }
  | { status: "unsupported_type" }
  | { status: "too_large" }
  | { status: "needs_manual_review"; candidateId: string }
  | { status: "needs_identity_check"; candidateId: string }
  | { status: "uploaded"; candidateId: string };

export async function runIngestStage(
  bytes: Buffer,
  originalFilename: string,
  appliedRole: "PM" | "SPM",
  opts: { isCalibration?: boolean } = {},
): Promise<IngestOutcome> {
  const fileHash = hashBytes(bytes);

  const [existing] = await db.select().from(candidates).where(eq(candidates.fileHash, fileHash));
  if (existing) {
    return { status: "duplicate", candidateId: existing.id };
  }

  const parsed = await ingestFile(bytes);
  if (!parsed.ok) {
    if (parsed.reason === "unsupported_type") return { status: "unsupported_type" };
    if (parsed.reason === "too_large") return { status: "too_large" };

    // thin_extraction: create the candidate so it's visible, but NEVER score it.
    const [row] = await db
      .insert(candidates)
      .values({
        appliedRole,
        status: "needs_manual_review",
        fileHash,
        isCalibration: opts.isCalibration ?? false,
      })
      .returning({ id: candidates.id });
    await logAudit({ event: "ingest.thin_extraction", candidateId: row.id, actor: "system", meta: { originalFilename } });
    return { status: "needs_manual_review", candidateId: row.id };
  }

  const { text, mime } = parsed;
  const nameGuess = guessNameFromCV(text, originalFilename);
  // Unconditional final gate -- see isPlausibleName's doc comment. Never
  // trust nameGuess.name directly, no matter how it was computed.
  const guessedName = nameGuess.name && isPlausibleName(nameGuess.name) ? nameGuess.name : null;
  if (nameGuess.name && !guessedName) {
    await logAudit({
      event: "ingest.implausible_name_guess_rejected",
      actor: "system",
      meta: { originalFilename, rejected: nameGuess.name },
    });
  }
  const pii = extractPII(text);

  const [row] = await db
    .insert(candidates)
    .values({
      appliedRole,
      status: guessedName ? "uploaded" : "needs_identity_check",
      fileHash,
      isCalibration: opts.isCalibration ?? false,
    })
    .returning({ id: candidates.id });

  await db.insert(candidateFiles).values({
    candidateId: row.id,
    mime,
    size: bytes.byteLength,
    bytes,
  });

  if (!guessedName) {
    // Store what we have; the UI will ask Arjun to confirm name + email
    // before the pipeline continues (see finalizeIdentity below).
    await db.insert(candidatePersonalDetails).values({
      candidateId: row.id,
      fullName: "",
      email: pii.emails[0] ?? null,
      phone: pii.phones[0] ?? null,
      links: pii.urls.concat(pii.handles),
      originalFilename,
    });
    await logAudit({ event: "ingest.needs_identity_check", candidateId: row.id, actor: "system" });
    return { status: "needs_identity_check", candidateId: row.id };
  }

  const identity = { fullName: guessedName, email: pii.emails[0] ?? null, phone: pii.phones[0] ?? null };
  const redacted = redactCV(text, identity, nameGuess.conflictingName ? [nameGuess.conflictingName] : []);
  const leak = leakCheck(redacted, identity);
  if (!leak.ok) {
    // Defensive: redaction should never leave a leak, but if it does, do not
    // proceed to any AI stage -- fall back to manual review.
    await db.update(candidates).set({ status: "needs_manual_review" }).where(eq(candidates.id, row.id));
    await logAudit({ event: "ingest.redaction_leak_detected", candidateId: row.id, actor: "system", meta: { matched: leak.matched } });
    return { status: "needs_manual_review", candidateId: row.id };
  }

  await db.insert(candidatePersonalDetails).values({
    candidateId: row.id,
    fullName: identity.fullName,
    email: identity.email,
    phone: identity.phone,
    links: pii.urls.concat(pii.handles),
    originalFilename,
  });

  await db.update(candidates).set({ cvTextRedacted: redacted }).where(eq(candidates.id, row.id));
  await logAudit({ event: "ingest.uploaded", candidateId: row.id, actor: "system" });

  return { status: "uploaded", candidateId: row.id };
}

/**
 * Called when Arjun types the name + email for a needs_identity_check
 * candidate. Re-runs redaction now that identity is known, then unblocks
 * the candidate into the normal `uploaded` pipeline.
 */
export async function finalizeIdentity(candidateId: string, fullName: string, email: string): Promise<void> {
  const [file] = await db.select().from(candidateFiles).where(eq(candidateFiles.candidateId, candidateId));
  if (!file) throw new Error("candidate file not found");

  const parsed = await ingestFile(Buffer.from(file.bytes));
  if (!parsed.ok) throw new Error("could not re-parse candidate file during identity finalisation");

  const [details] = await db
    .select()
    .from(candidatePersonalDetails)
    .where(eq(candidatePersonalDetails.candidateId, candidateId));

  const identity = { fullName, email, phone: details?.phone ?? null };
  const redacted = redactCV(parsed.text, identity);
  const leak = leakCheck(redacted, identity);

  await db
    .update(candidatePersonalDetails)
    .set({ fullName, email })
    .where(eq(candidatePersonalDetails.candidateId, candidateId));

  if (!leak.ok) {
    await db.update(candidates).set({ status: "needs_manual_review" }).where(eq(candidates.id, candidateId));
    await logAudit({ event: "ingest.redaction_leak_detected", candidateId, actor: "arjun", meta: { matched: leak.matched } });
    return;
  }

  await db
    .update(candidates)
    .set({ cvTextRedacted: redacted, status: "uploaded" })
    .where(eq(candidates.id, candidateId));
  await logAudit({ event: "ingest.identity_confirmed", candidateId, actor: "arjun" });
}
