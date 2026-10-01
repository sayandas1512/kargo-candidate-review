import { describe, it, expect } from "vitest";
import { extractPII, redactCV, leakCheck, guessNameFromCV, isPlausibleName } from "@/lib/pii-guard";

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
    expect(guessNameFromCV(SAMPLE_CV, "cv.pdf").name).toBe("Rohan Desai");
  });

  it("falls back to the filename when the header has no clean name line", () => {
    const noHeader = "Experience:\n- Did things.\n- Did more things.";
    expect(guessNameFromCV(noHeader, "cv_07_lavanya_iyer.docx").name).toBe("Lavanya Iyer");
  });

  it("does not mistake a section header for a name (real leak found in production)", () => {
    const cv = "Strategic & Marketing Lead\nPROFESSIONAL SUMMARY\nA marketer with 8+ years of experience.";
    // No name in the header area at all, and the filename has no real name either --
    // must fall through to null (needs_identity_check), never guess the header text.
    expect(guessNameFromCV(cv, "resume.pdf").name).toBeNull();
  });

  it("stops scanning for a name once a section header is reached, even if a later line looks name-shaped", () => {
    const cv = "Strategy & Operations Leader\nEDUCATION\nPGDM (Full-Time)\nIMT Ghaziabad | 2022 - 2024";
    // "IMT Ghaziabad" is title-cased and regex-shaped like a name, but it's an
    // institution under EDUCATION, past the header area -- must not be guessed.
    expect(guessNameFromCV(cv, "resume.pdf").name).toBeNull();
  });

  it("falls through to the filename once the header is correctly rejected", () => {
    const cv = "PROFESSIONAL SYNOPSIS\nProduct leader with 17 years of experience.";
    expect(guessNameFromCV(cv, "03_arnav_sen.pdf").name).toBe("Arnav Sen");
  });

  it("uses the filename when the header is garbled, even though it is structurally name-shaped", () => {
    // Caught live in production: PDF text extraction for one specific file
    // was observed to intermittently return a wrong, title-case-shaped
    // header guess even after the section-header blocklist fix (root cause
    // in the PDF parser was never fully pinned down). "Global Delivery
    // Office" passes the bare title-case regex just like a real name would
    // -- the institutional-word check is what actually tells them apart.
    const cv = "Global Delivery Office\nProduct leader with 17 years of experience.";
    const guess = guessNameFromCV(cv, "03_arnav_sen.pdf");
    expect(guess.name).toBe("Arnav Sen");
    expect(guess.conflictingName).toBeNull(); // header was invalid, not merely disagreeing
  });

  it("header wins over an independently-plausible but disagreeing filename, and flags the filename name for redaction too", () => {
    // The header is clean and correct; the filename just happens to also be
    // name-shaped (e.g. a fixture/project naming convention) for an unrelated
    // reason. The header must not be silently overridden -- but the
    // filename-derived name is still returned as conflictingName so its
    // tokens get redacted defensively.
    const cv = "Zendaya Okonkwo-Platt\nProduct leader with 17 years of experience.";
    const guess = guessNameFromCV(cv, "strong_pm.pdf");
    expect(guess.name).toBe("Zendaya Okonkwo-Platt");
    expect(guess.conflictingName).toBe("Strong Pm");

    const identity = { fullName: guess.name!, email: null, phone: null };
    const redacted = redactCV(cv, identity, [guess.conflictingName!]);
    expect(redacted.toLowerCase()).not.toContain("zendaya");
    expect(redacted.toLowerCase()).not.toContain("okonkwo");
    expect(redacted.toLowerCase()).not.toContain("strong");
  });

  it("trusts the header guess when it corroborates the filename", () => {
    const cv = "Arnav Sen\nProduct leader with 17 years of experience.";
    expect(guessNameFromCV(cv, "03_arnav_sen.pdf").name).toBe("Arnav Sen");
  });

  it("trusts a good header even though Resume_Final.pdf contributes no filename signal", () => {
    const cv = "Arnav Sen\nProduct leader with 17 years of experience.";
    const guess = guessNameFromCV(cv, "Resume_Final.pdf");
    expect(guess.name).toBe("Arnav Sen");
    expect(guess.conflictingName).toBeNull();
  });

  it("redacts a name even when a PDF extraction artifact fuses it to the previous word with no space", () => {
    // Real production case: a footer watermark extracted as "SHARMAPriya Sharma"
    // (name repeated twice, glued together with no whitespace boundary).
    const identity = { fullName: "Priya Sharma", email: null, phone: null };
    const cv = "Some CV content here.\nPRIYA SHARMAPriya Sharma\nsquad_1@pg27.";
    const redacted = redactCV(cv, identity);
    expect(leakCheck(redacted, identity)).toEqual({ ok: true });
    expect(redacted.toLowerCase()).not.toContain("priya");
  });
});

describe("isPlausibleName", () => {
  it("accepts a real-looking two-word name", () => {
    expect(isPlausibleName("Arnav Sen")).toBe(true);
  });

  it("rejects a resume section header even if title-cased", () => {
    expect(isPlausibleName("Professional Synopsis")).toBe(false);
    expect(isPlausibleName("PROFESSIONAL SYNOPSIS")).toBe(false);
  });

  it("rejects a single word", () => {
    expect(isPlausibleName("Professional")).toBe(false);
  });

  it("is the unconditional final gate -- catches a bad name regardless of how it was produced", () => {
    // Simulates whatever upstream computation might (for any reason, known
    // or not) hand a section header to the ingest pipeline as if it were a
    // guessed name -- this must never be trusted, full stop.
    const suspiciousUpstreamValue = "PROFESSIONAL SYNOPSIS";
    expect(isPlausibleName(suspiciousUpstreamValue)).toBe(false);
  });
});
