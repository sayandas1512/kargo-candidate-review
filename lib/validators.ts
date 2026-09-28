import { leakCheck } from "./pii";
import type { Identity } from "./ai/gemini";

/** Splits on ./!/? followed by whitespace or end of string. Good enough for
 * short, model-generated single sentences -- not a general NLP splitter. */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const matches = trimmed.match(/[^.!?]+[.!?]+(\s+|$)/g);
  if (matches) return matches.length;
  return 1; // no terminal punctuation found; treat as one ragged sentence
}

export function extractNumbers(text: string): string[] {
  return Array.from(new Set((text.match(/\d+(\.\d+)?%?/g) ?? []).filter((n) => n.length > 0)));
}

export function numbersGroundedIn(text: string, sourceText: string): boolean {
  const numbers = extractNumbers(text);
  return numbers.every((n) => sourceText.includes(n));
}

export type BriefValidationResult = { ok: true } | { ok: false; reason: string };

export function validateBrief(
  brief: { who: string; why: string; probe: string },
  identity: Identity,
  sourceText: string,
): BriefValidationResult {
  for (const [field, text] of Object.entries(brief)) {
    if (countSentences(text) !== 1) {
      return { ok: false, reason: `${field} must be exactly one sentence` };
    }
  }
  const full = `${brief.who} ${brief.why} ${brief.probe}`;
  const leak = leakCheck(full, identity);
  if (!leak.ok) return { ok: false, reason: `identity leak: matched "${leak.matched}"` };
  if (!numbersGroundedIn(full, sourceText)) {
    return { ok: false, reason: "brief contains a number not present in the score/extraction inputs" };
  }
  return { ok: true };
}

const FORBIDDEN_EMAIL_WORDS = [
  "score",
  "rank",
  "rubric",
  "ai",
  "algorithm",
  "automated",
  "model",
  "gemini",
  "percent",
  "offer",
  "guarantee",
];

export type EmailValidationResult = { ok: true } | { ok: false; reason: string };

export function validateEmailDraft(
  draft: { subject: string; body: string },
  kind: "invite" | "rejection",
): EmailValidationResult {
  if (!draft.subject.trim()) return { ok: false, reason: "subject is empty" };

  const nameMatches = draft.body.match(/\[NAME\]/g) ?? [];
  if (nameMatches.length !== 1) {
    return { ok: false, reason: `[NAME] must appear exactly once, found ${nameMatches.length}` };
  }
  const otherPlaceholders = draft.body.match(/\[[A-Z_]+\]/g) ?? [];
  if (otherPlaceholders.some((p) => p !== "[NAME]")) {
    return { ok: false, reason: "body contains a bracketed placeholder other than [NAME]" };
  }

  if (/https?:\/\//i.test(draft.body)) {
    return { ok: false, reason: "body contains a URL" };
  }

  const lower = (draft.subject + " " + draft.body).toLowerCase();
  for (const word of FORBIDDEN_EMAIL_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(lower)) return { ok: false, reason: `body contains forbidden word "${word}"` };
  }

  const wordCount = draft.body.trim().split(/\s+/).filter(Boolean).length;
  if (kind === "rejection" && wordCount > 120) {
    return { ok: false, reason: `rejection body is ${wordCount} words, over the 120 word limit` };
  }
  if (wordCount > 300) {
    return { ok: false, reason: `body is ${wordCount} words, too long` };
  }

  const noPromiseRe = /(keep your cv on file|we'?ll keep|will keep your (resume|cv))/i;
  if (kind === "rejection" && noPromiseRe.test(draft.body)) {
    return { ok: false, reason: "rejection body makes a promise it shouldn't" };
  }

  return { ok: true };
}
