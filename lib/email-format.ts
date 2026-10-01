function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Draft bodies use blank lines ("\n\n") between greeting / body / sign-off.
 * Resend was only ever given `text`, and several mail clients (Gmail's
 * "format=flowed" handling among them) reflow a plain-text-only email and
 * join those lines back into one paragraph. Sending a matching `html` part
 * alongside `text` is the standard fix -- clients render the html part and
 * stop guessing at paragraph boundaries.
 */
export function textToEmailHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 1em 0;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;">${paragraphs}</div>`;
}
