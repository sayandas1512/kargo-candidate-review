import "dotenv/config";
import { readFileSync } from "node:fs";
import { ingestFile } from "../../lib/ingest";
import { extractPII, guessNameFromCV, redactCV } from "../../lib/pii";
import { extractCV } from "../../lib/ai/extract";
import type { ScorerInput } from "../../lib/ai/score";

/**
 * Shared by scripts/calibrate.ts, scripts/stability.ts, and
 * scripts/injection-fixture.ts: parses a CV file straight off disk,
 * redacts it, and runs the real extraction stage -- all without touching
 * the database, so these smoke tests work before Neon is linked.
 */
export async function prepareCV(filePath: string) {
  const bytes = readFileSync(filePath);
  const parsed = await ingestFile(bytes);
  if (!parsed.ok) throw new Error(`could not parse ${filePath}: ${parsed.reason}`);

  const guessedName = guessNameFromCV(parsed.text, filePath) ?? "Unknown Candidate";
  const pii = extractPII(parsed.text);
  const identity = { fullName: guessedName, email: pii.emails[0] ?? null, phone: pii.phones[0] ?? null };
  const redacted = redactCV(parsed.text, identity);

  const extraction = await extractCV(redacted, identity);
  const scorerInput: ScorerInput = { roles: extraction.roles, skills: extraction.skills };

  return { identity, redacted, extraction, scorerInput };
}
