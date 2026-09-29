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
export function guessNameFromCV(text: string, filename: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8);

  const namePattern = /^[A-Z][a-zA-Z'.-]+(\s+[A-Z][a-zA-Z'.-]+){1,3}$/;
  for (const line of lines) {
    const stripped = line.replace(/[|,•·]+/g, " ").trim();
    const candidate = stripped.split(/\s{2,}|\t/)[0].trim();
    if (namePattern.test(candidate) && candidate.split(/\s+/).length <= 4) {
      return candidate;
    }
  }

  // Fall back to the filename: e.g. "cv_01_rohan_desai.docx" -> "Rohan Desai"
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

function nameTokens(name: string): string[] {
  return name.split(/\s+/).filter((t) => t.length >= 3);
}

/**
 * Produces cv_text_redacted: strips every occurrence of every 3+ letter
 * token of the name, the email, the phone (in any format matched by
 * PHONE_RE), and every URL/handle. Deterministic, no AI involved.
 */
export function redactCV(
  text: string,
  identity: { fullName: string; email?: string | null; phone?: string | null },
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

  for (const token of nameTokens(identity.fullName)) {
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    redacted = redacted.replace(re, "[REDACTED]");
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
