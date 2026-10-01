import { describe, it, expect } from "vitest";
import { textToEmailHtml } from "@/lib/email-format";

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
