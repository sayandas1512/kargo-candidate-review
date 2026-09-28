import { describe, it, expect } from "vitest";
import { extractPII, redactCV, leakCheck, guessNameFromCV } from "@/lib/pii";

const IDENTITY = { fullName: "Rohan Desai", email: "rohan.desai@example.com", phone: "+91 98765 43210" };

const SAMPLE_CV = `Rohan Desai
rohan.desai@example.com | +91 98765 43210 | linkedin.com/in/rohandesai | github.com/rdesai

Head of Engineering, Kargo Logistics (2021 - Present)
- Led a vendor migration, cutting lag by 60% with no data loss.
- Built a BoL verification prototype over a weekend; 30 colleagues used it within a month.

CHA Operations, JNPT (2016 - 2019)
- Handled customs documentation for freight forwarding at the port.

Contact me at rohan.d.alt@gmail.com or (022) 6543-2109 for more.`;

describe("extractPII", () => {
  it("finds emails, phones, urls, and handles", () => {
    const pii = extractPII(SAMPLE_CV);
    expect(pii.emails).toContain("rohan.desai@example.com");
    expect(pii.emails).toContain("rohan.d.alt@gmail.com");
    expect(pii.urls.some((u) => u.includes("linkedin"))).toBe(false); // bare domain, not http(s) URL
    expect(pii.handles.some((h) => h.includes("linkedin.com/in/rohandesai"))).toBe(true);
    expect(pii.handles.some((h) => h.includes("github.com/rdesai"))).toBe(true);
  });
});

describe("redactCV + leakCheck", () => {
  it("removes every occurrence of the name, email, phone, urls and handles", () => {
    const redacted = redactCV(SAMPLE_CV, IDENTITY);
    const result = leakCheck(redacted, IDENTITY);
    expect(result.ok).toBe(true);
  });

  it("redacts a secondary email not in candidate_personal_details", () => {
    const redacted = redactCV(SAMPLE_CV, IDENTITY);
    expect(redacted).not.toContain("rohan.d.alt@gmail.com");
  });

  it("redacts phone numbers in a different format than the one on file", () => {
    const redacted = redactCV(SAMPLE_CV, IDENTITY);
    expect(redacted).not.toContain("6543-2109");
  });

  it("redacts every name token, not just the full string", () => {
    const redacted = redactCV(SAMPLE_CV, IDENTITY);
    expect(redacted.toLowerCase()).not.toContain("rohan");
    expect(redacted.toLowerCase()).not.toContain("desai");
  });

  it("leakCheck fails on unredacted text", () => {
    const result = leakCheck(SAMPLE_CV, IDENTITY);
    expect(result.ok).toBe(false);
  });

  it("leakCheck catches a name token embedded mid-sentence", () => {
    const result = leakCheck("This candidate is named Rohan in the header.", IDENTITY);
    expect(result.ok).toBe(false);
  });

  it("leakCheck passes on genuinely clean text", () => {
    const result = leakCheck("This candidate led a vendor migration cutting lag by 60%.", IDENTITY);
    expect(result.ok).toBe(true);
  });
});

describe("guessNameFromCV", () => {
  it("finds the name from the CV header", () => {
    expect(guessNameFromCV(SAMPLE_CV, "cv.pdf")).toBe("Rohan Desai");
  });

  it("falls back to the filename when the header has no clean name line", () => {
    const noHeader = "Experience:\n- Did things.\n- Did more things.";
    expect(guessNameFromCV(noHeader, "cv_07_lavanya_iyer.docx")).toBe("Lavanya Iyer");
  });
});
