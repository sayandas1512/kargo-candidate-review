import { describe, it, expect } from "vitest";
import { validateEmailDraft, validateBrief, countSentences } from "@/lib/validators";

describe("validateEmailDraft", () => {
  const goodInvite = {
    subject: "Kargo PM role: let's talk",
    body: "Hi [NAME],\n\nThanks for applying. I'd like to talk with you about the role.\n\nBest,\nArjun Mehta, Founder, Kargo",
  };

  it("accepts a well-formed invite", () => {
    expect(validateEmailDraft(goodInvite, "invite")).toEqual({ ok: true });
  });

  it("rejects an empty subject", () => {
    const result = validateEmailDraft({ ...goodInvite, subject: "" }, "invite");
    expect(result.ok).toBe(false);
  });

  it("rejects a body missing [NAME]", () => {
    const result = validateEmailDraft({ ...goodInvite, body: "Hi there,\n\nThanks." }, "invite");
    expect(result.ok).toBe(false);
  });

  it("rejects a body with [NAME] appearing twice", () => {
    const result = validateEmailDraft({ ...goodInvite, body: "Hi [NAME], nice to meet you [NAME]." }, "invite");
    expect(result.ok).toBe(false);
  });

  it("rejects a body with a bracketed placeholder other than [NAME]", () => {
    const result = validateEmailDraft({ ...goodInvite, body: "Hi [NAME], see you on [DATE]." }, "invite");
    expect(result.ok).toBe(false);
  });

  it("rejects a body containing a URL", () => {
    const result = validateEmailDraft({ ...goodInvite, body: "Hi [NAME], visit https://kargo.example for details." }, "invite");
    expect(result.ok).toBe(false);
  });

  it.each(["score", "rank", "rubric", "algorithm", "Gemini", "guarantee"])(
    "rejects a body containing the forbidden word '%s'",
    (word) => {
      const result = validateEmailDraft({ ...goodInvite, body: `Hi [NAME], your ${word} was noted.` }, "invite");
      expect(result.ok).toBe(false);
    },
  );

  it("rejects a rejection body over 120 words", () => {
    const longBody = "Hi [NAME],\n\n" + "word ".repeat(130) + "\n\nBest,\nArjun Mehta, Founder, Kargo";
    const result = validateEmailDraft({ subject: "Update", body: longBody }, "rejection");
    expect(result.ok).toBe(false);
  });

  it("rejects a rejection promising to keep the CV on file", () => {
    const body = "Hi [NAME],\n\nWe'll keep your CV on file.\n\nBest,\nArjun Mehta, Founder, Kargo";
    const result = validateEmailDraft({ subject: "Update", body }, "rejection");
    expect(result.ok).toBe(false);
  });
});

describe("countSentences", () => {
  it("counts one sentence", () => {
    expect(countSentences("This candidate led a vendor migration.")).toBe(1);
  });

  it("counts multiple sentences", () => {
    expect(countSentences("This candidate led a migration. It cut lag by 60%.")).toBe(2);
  });
});

describe("validateBrief", () => {
  const identity = { fullName: "Rohan Desai", email: "rohan@example.com", phone: "9876543210" };
  const source = "PM-1: score 4, evidence: led a vendor migration, rationale: strong ops background. Roles: Head of Engineering at Kargo";

  it("accepts three clean one-sentence fields grounded in the source", () => {
    const brief = {
      who: "This candidate most recently worked as Head of Engineering at Kargo.",
      why: "They rank here on the strength of PM-1, scored 4 out of 4.",
      probe: "In interview, probe their weakest heavily-weighted criterion.",
    };
    expect(validateBrief(brief, identity, source)).toEqual({ ok: true });
  });

  it("rejects a field with two sentences", () => {
    const brief = {
      who: "This candidate worked as an engineer. They also did other things.",
      why: "They rank here on strong evidence.",
      probe: "Probe their weakest area.",
    };
    const result = validateBrief(brief, identity, source);
    expect(result.ok).toBe(false);
  });

  it("rejects a brief that leaks the candidate's name", () => {
    const brief = {
      who: "Rohan Desai most recently worked as Head of Engineering.",
      why: "They rank here on strong evidence.",
      probe: "Probe their weakest area.",
    };
    const result = validateBrief(brief, identity, source);
    expect(result.ok).toBe(false);
  });

  it("rejects a brief with a number not present in the source", () => {
    const brief = {
      who: "This candidate worked as an engineer for 12 years.",
      why: "They rank here on strong evidence.",
      probe: "Probe their weakest area.",
    };
    const result = validateBrief(brief, identity, source);
    expect(result.ok).toBe(false);
  });
});
