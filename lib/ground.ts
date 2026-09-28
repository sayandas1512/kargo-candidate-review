function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Grounding check for an evidence_quote against the candidate's redacted
 * content: normalised exact substring match, falling back to >=85% token
 * overlap for paraphrase drift. An empty quote is never grounded.
 */
export function isGrounded(quote: string, sourceText: string): boolean {
  if (!quote || !quote.trim()) return false;
  const normQuote = normalize(quote);
  if (!normQuote) return false;
  const normSource = normalize(sourceText);

  if (normSource.includes(normQuote)) return true;

  const quoteTokens = normQuote.split(" ").filter(Boolean);
  if (quoteTokens.length === 0) return false;
  const sourceTokenSet = new Set(normSource.split(" ").filter(Boolean));
  const matched = quoteTokens.filter((t) => sourceTokenSet.has(t)).length;
  return matched / quoteTokens.length >= 0.85;
}
