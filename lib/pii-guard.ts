export type ExtractedPII = {
  emails: string[];
  phones: string[];
  urls: string[];
  handles: string[];
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_RE = /\bhttps?:\/\/[^\s,)]+/gi;
// Any bare "domain.tld/path" reference without an http(s):// prefix -- covers
// linkedin.com/in/foo, github.com/foo, leetcode.com/foo, personal portfolio
// domains, and anything else shaped like a profile link. Deliberately broad:
// a rare over-match (redacting a non-PII domain-shaped token) is the safe
// direction; an under-match is a PII leak.
const BARE_HANDLE_RE = /\b[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,6}\/[a-zA-Z0-9._\-/]+/g;
const AT_HANDLE_RE = /(?<![a-zA-Z0-9._%+-])@[a-zA-Z][a-zA-Z0-9_]{2,30}\b/g;
// Phone numbers: sequences of digits/spaces/dashes/dots/parens of length 7-15 digits,
// optionally prefixed with +country code.
const PHONE_RE = /(\+?\d[\d\s().-]{7,17}\d)/g;

export function extractPII(text: string): ExtractedPII {
  const emails = Array.from(new Set(text.match(EMAIL_RE) ?? []));
  const urls = Array.from(new Set(text.match(URL_RE) ?? []));
  const bareHandles = text.match(BARE_HANDLE_RE) ?? [];
  const atHandles = text.match(AT_HANDLE_RE) ?? [];
  const handles = Array.from(new Set([...bareHandles, ...atHandles]));

  const phoneCandidates = text.match(PHONE_RE) ?? [];
  const phones = Array.from(
    new Set(
      phoneCandidates.filter((p) => {
        const digits = p.replace(/\D/g, "");
        return digits.length >= 7 && digits.length <= 15;
      }),
    ),
  );

  return { emails, phones, urls, handles };
}

/**
 * Finds the candidate's name from the CV header (first ~5 non-empty lines)
 * and the filename. Returns null if it cannot find a confident match, in
 * which case the caller must route the candidate to needs_identity_check.
 */
// Common resume section headers. A line matching one of these is never a
// name, AND it marks the end of the "header area" -- once we've reached it,
// nothing further down the page (job titles, institution names, degree
// lines, etc.) is considered a name candidate either, even if it happens to
// look title-cased like one (e.g. "IMT Ghaziabad" under an EDUCATION
// header). Real names sit above the first section header; a name that only
// appears elsewhere (a footer watermark, a references section) is exactly
// the low-confidence case that must fall through to needs_identity_check
// rather than be guessed wrong.
const SECTION_HEADER_RE =
  /^(professional\s+)?(summary|synopsis|profile|objective|overview)$|^(career\s+)?objective$|^education(al)?( background)?$|^(work\s+|professional\s+)?experience$|^employment( history)?$|^(core\s+)?(competenc(y|ies)|skills?|strengths?)$|^(technical\s+)?skills?$|^certifications?$|^projects?$|^achievements?$|^awards?$|^publications?$|^languages?$|^references?$|^declaration$|^personal\s+details$|^contact( info(rmation)?)?$|^(professional\s+)?development( (&|and) skills)?$|^training$|^interests?$|^hobbies$|^volunteer(ing)?$|^leadership$|^summary of qualifications$/i;

const namePattern = /^[A-Z][a-zA-Z'.-]+(\s+[A-Z][a-zA-Z'.-]+){1,3}$/;

// Words that show up in garbled header extractions (org units, generic job
// titles pulled from the wrong line) but are never, on their own, a person's
// given or family name. A name-shaped candidate containing one of these as a
// whole word is almost certainly extraction noise, not a real name -- e.g.
// "Global Delivery Office" structurally passes namePattern (three title-case
// words) exactly like a real name would, so this is the signal that tells
// the two apart.
const INSTITUTIONAL_WORD_RE =
  /^(office|delivery|global|solutions?|group|services?|department|division|team|enterprise|holdings|international|consulting|technologies|systems|networks|partners|ventures|corporation|company|limited|inc|llc|ltd)$/i;

function containsInstitutionalWord(name: string): boolean {
  return name.split(/\s+/).some((w) => INSTITUTIONAL_WORD_RE.test(w));
}

function headerGuess(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);

  for (const line of lines) {
    const stripped = line.replace(/[|,•·]+/g, " ").trim();
    if (SECTION_HEADER_RE.test(stripped)) break; // past the header area -- stop looking
    const candidate = stripped.split(/\s{2,}|\t/)[0].trim();
    if (SECTION_HEADER_RE.test(candidate)) break;
    if (namePattern.test(candidate) && candidate.split(/\s+/).length <= 4) {
      return candidate;
    }
  }
  return null;
}

function filenameGuess(filename: string): string | null {
  const base = filename.replace(/\.(docx|pdf)$/i, "");
  const tokens = base
    .split(/[_\-.\s]+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !/^(cv|resume|final|v\d+)$/i.test(t));
  if (tokens.length >= 2 && tokens.length <= 4) {
    const guess = tokens.map((t) => t[0].toUpperCase() + t.slice(1).toLowerCase()).join(" ");
    if (namePattern.test(guess)) return guess;
  }
  return null;
}

function sharesToken(a: string, b: string): boolean {
  const tokensA = new Set(a.toLowerCase().split(/\s+/));
  return b.toLowerCase().split(/\s+/).some((t) => tokensA.has(t));
}

export type NameGuess = {
  /** The name to use for identity and the [NAME] greeting. */
  name: string | null;
  /**
   * Set only when the header and filename both produced a plausible but
   * disagreeing name and the header won. The filename guess is still real
   * candidate-adjacent text that showed up in a PII-sensing context, so its
   * tokens get redacted from the CV too even though they're not used as the
   * identity -- see redactCV's additionalNames parameter.
   */
  conflictingName: string | null;
};

/**
 * Header-first: a header guess is trusted whenever it independently passes
 * isPlausibleName (not a section header, not institutional-sounding noise
 * like "Global Delivery Office"). The filename is only consulted when the
 * header is missing or fails that check -- never to override a header that
 * validates, even if the two disagree. On a genuine disagreement between two
 * independently-plausible names, the filename guess is NOT discarded: its
 * tokens are returned as conflictingName so the caller redacts them too,
 * since silently dropping a name-shaped string from a PII-handling path
 * would be the under-redaction failure mode this file exists to avoid.
 */
export function guessNameFromCV(text: string, filename: string): NameGuess {
  const fromHeader = headerGuess(text);
  const fromFilename = filenameGuess(filename);
  const headerValid = fromHeader !== null && isPlausibleName(fromHeader);
  const filenameValid = fromFilename !== null && isPlausibleName(fromFilename);

  if (headerValid) {
    const disagrees = filenameValid && !sharesToken(fromHeader!, fromFilename!);
    return { name: fromHeader, conflictingName: disagrees ? fromFilename : null };
  }

  if (filenameValid) {
    return { name: fromFilename, conflictingName: null };
  }

  return { name: null, conflictingName: null };
}

/**
 * Unconditional final gate: is `name` plausible as a person's name at all?
 * Independent of how it was computed -- callers MUST run any guessed name
 * through this immediately before persisting it as identity, so that no
 * upstream bug (known or not yet found) can result in a resume section
 * header or similar non-name string being stored and treated as a real
 * identity. This is deliberately redundant with the checks inside
 * guessNameFromCV; redundant checks are the point.
 */
export function isPlausibleName(name: string): boolean {
  const trimmed = name.trim();
  if (!namePattern.test(trimmed)) return false;
  if (SECTION_HEADER_RE.test(trimmed)) return false;
  if (containsInstitutionalWord(trimmed)) return false;
  return true;
}

function nameTokens(name: string): string[] {
  return name.split(/\s+/).filter((t) => t.length >= 3);
}

/**
 * Produces cv_text_redacted: strips every occurrence of every 3+ letter
 * token of the name, the email, the phone (in any format matched by
 * PHONE_RE), and every URL/handle. Deterministic, no AI involved.
 *
 * additionalNames: other name-shaped strings to also strip tokens for, even
 * though they aren't the identity on file -- e.g. a filename-derived guess
 * that disagreed with the (trusted) header guess. It showed up as a
 * plausible name in a PII-sensing context, so it gets redacted too.
 */
export function redactCV(
  text: string,
  identity: { fullName: string; email?: string | null; phone?: string | null },
  additionalNames: string[] = [],
): string {
  let redacted = text;

  const { urls, handles } = extractPII(redacted);
  for (const u of urls) redacted = redacted.split(u).join("[REDACTED]");
  for (const h of handles) redacted = redacted.split(h).join("[REDACTED]");

  if (identity.email) {
    redacted = redacted.split(identity.email).join("[REDACTED]");
  }
  // Catch any other email-shaped strings too (secondary addresses on the CV).
  redacted = redacted.replace(EMAIL_RE, "[REDACTED]");

  if (identity.phone) {
    const digits = identity.phone.replace(/\D/g, "");
    if (digits.length >= 6) {
      const flexible = new RegExp(digits.split("").join("[\\s().-]*"), "g");
      redacted = redacted.replace(flexible, "[REDACTED]");
    }
  }
  redacted = redacted.replace(PHONE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 ? "[REDACTED]" : m;
  });

  for (const name of [identity.fullName, ...additionalNames]) {
    for (const token of nameTokens(name)) {
      // No \b boundary: some PDF extractions fuse adjacent text runs with no
      // whitespace (e.g. a name repeated in a watermark as "SHARMAPriya"), so
      // a name token can appear with no word boundary on one side. A plain
      // substring match is the safe direction here -- over-redacting a rare
      // unrelated word that happens to contain the name is far better than
      // leaving real PII in text that gets sent to Gemini.
      const re = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      redacted = redacted.replace(re, "[REDACTED]");
    }
  }

  return redacted;
}

/**
 * Leak check: no identity token may remain in `text`. Must pass before any
 * AI call — see assertNoPII in lib/ai/gemini.ts, which calls the same logic.
 * Name tokens are matched as a plain substring (no \b boundary): a name
 * fused into an unredacted handle like "leetcode.com/preethamrao" has no
 * word boundary before "rao", but it is still a leak. Over-flagging a
 * coincidental substring is the safe failure mode (needs_manual_review);
 * missing a real leak is not.
 */
export function leakCheck(
  text: string,
  identity: { fullName?: string | null; email?: string | null; phone?: string | null },
): { ok: true } | { ok: false; matched: string } {
  const lowerText = text.toLowerCase();
  for (const token of nameTokens(identity.fullName ?? "")) {
    if (lowerText.includes(token.toLowerCase())) return { ok: false, matched: token };
  }
  if (identity.email) {
    const re = new RegExp(identity.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (re.test(text)) return { ok: false, matched: identity.email };
  }
  if (identity.phone) {
    const digits = identity.phone.replace(/\D/g, "");
    if (digits.length >= 6) {
      const flexible = new RegExp(digits.split("").join("[\\s().-]*"));
      if (flexible.test(text)) return { ok: false, matched: identity.phone };
    }
  }
  const { emails, urls, handles } = extractPII(text);
  if (emails.length) return { ok: false, matched: emails[0] };
  if (urls.length) return { ok: false, matched: urls[0] };
  if (handles.length) return { ok: false, matched: handles[0] };
  return { ok: true };
}
