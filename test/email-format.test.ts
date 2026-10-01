import { describe, it, expect } from "vitest";
import { textToEmailHtml } from "@/lib/email-format";
import { ensureParagraphBreaks } from "@/lib/ai/email";

describe("textToEmailHtml", () => {
  it("wraps each blank-line-separated paragraph in its own <p>", () => {
    const html = textToEmailHtml("Hi Aditya,\n\nThanks for applying.\n\nBest,\nArjun Mehta, Founder, Kargo");
    expect(html).toContain("<p");
    expect(html.match(/<p/g)?.length).toBe(3);
    expect(html).toContain("Hi Aditya,</p>");
    expect(html).toContain("Thanks for applying.</p>");
  });

  it("turns a single newline within a paragraph into <br>", () => {
    const html = textToEmailHtml("Best,\nArjun Mehta, Founder, Kargo");
    expect(html).toContain("Best,<br>Arjun Mehta, Founder, Kargo");
  });

  it("escapes HTML-significant characters", () => {
    const html = textToEmailHtml("Role: PM & SPM <urgent>");
    expect(html).toContain("PM &amp; SPM &lt;urgent&gt;");
    expect(html).not.toContain("<urgent>");
  });

  it("drops empty paragraphs from excess blank lines", () => {
    const html = textToEmailHtml("Hi,\n\n\n\nBest,\nArjun");
    expect(html.match(/<p/g)?.length).toBe(2);
  });
});

describe("ensureParagraphBreaks", () => {
  it("splits a run-on greeting/body/sign-off into paragraphs when there is no break at all", () => {
    const flat = "Hi [NAME], Thanks for applying to Kargo. I'd love to chat. Best, Arjun Mehta, Founder, Kargo";
    const fixed = ensureParagraphBreaks(flat);
    expect(fixed.split(/\n\s*\n/).length).toBeGreaterThanOrEqual(3);
    expect(fixed.startsWith("Hi [NAME],\n\n")).toBe(true);
    expect(fixed.endsWith("Best,\nArjun Mehta, Founder, Kargo")).toBe(true);
  });

  it("leaves a body that already has paragraph breaks untouched", () => {
    const good = "Hi [NAME],\n\nThanks for applying.\n\nBest,\nArjun Mehta, Founder, Kargo";
    expect(ensureParagraphBreaks(good)).toBe(good);
  });

  it("handles a sign-off with no closing word before it", () => {
    const flat = "Hi [NAME], Thanks for applying to Kargo. Arjun Mehta, Founder, Kargo";
    const fixed = ensureParagraphBreaks(flat);
    expect(fixed.endsWith("\n\nArjun Mehta, Founder, Kargo")).toBe(true);
  });
});
