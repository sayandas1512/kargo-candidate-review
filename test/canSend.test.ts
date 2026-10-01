import { describe, it, expect, beforeEach, vi } from "vitest";

// canSend queries the DB through a fixed sequence of db.select() calls. This
// fake resolves each call from a queue set per test, so we can drive the
// exact DB state for each condition in the matrix without a live database.
const queue = vi.hoisted(() => ({ rows: [] as unknown[][] }));

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.where = () => c;
  c.orderBy = () => c;
  c.limit = () => c;
  c.then = (resolve: (v: unknown[]) => void) => resolve(result);
  return c;
}

vi.mock("@/db", () => ({
  db: {
    select: () => chain(queue.rows.shift() ?? []),
  },
}));

// isCandidateShortlisted does its own multi-query ranking computation
// (rubric lookup, then a candidates+scores join across every candidate) --
// mocking the function directly, rather than feeding its queries through the
// same db.select() queue as everything else, keeps condition-8 tests from
// having to know its internal call shape.
const shortlistedMock = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/pipeline/finalize", () => ({
  isCandidateShortlisted: async () => shortlistedMock.value,
}));

const { canSend } = await import("@/lib/canSend");

const CANDIDATE = { id: "c1", status: "ready", appliedRole: "PM", firstOpenedAt: new Date(), isCalibration: false };
const ADVANCE_DECISION = { decision: "advance", decidedAt: new Date() };
const DECLINE_DECISION = { decision: "decline", decidedAt: new Date() };
const HOLD_DECISION = { decision: "hold", decidedAt: new Date() };
const GOOD_DRAFT = {
  id: "d1",
  kind: "invite",
  status: "draft",
  subject: "Hi",
  bodyTemplate: "Hi [NAME],\n\nLet's talk.\n\nBest,\nArjun Mehta, Founder, Kargo",
};

beforeEach(() => {
  queue.rows = [];
  // Matches the pre-existing tests' implicit assumption (invite to a
  // shortlisted candidate = no placement contradiction); the one existing
  // "allows" test on the rejection path overrides this explicitly.
  shortlistedMock.value = true;
});

describe("canSend", () => {
  it("allows when every condition is met", async () => {
    queue.rows = [[CANDIDATE], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("blocks when candidate status is needs_manual_review", async () => {
    queue.rows = [[{ ...CANDIDATE, status: "needs_manual_review" }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/needs_manual_review/);
  });

  it("blocks when candidate status is needs_identity_check", async () => {
    queue.rows = [[{ ...CANDIDATE, status: "needs_identity_check" }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
  });

  it("blocks when candidate status is failed", async () => {
    queue.rows = [[{ ...CANDIDATE, status: "failed" }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
  });

  it("blocks when the scorecard has not been opened", async () => {
    // canSend itself does not check firstOpenedAt via the candidate row in
    // this fake (it's a column on the same row) -- simulate by omitting it.
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: null }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/opened/);
  });

  it("blocks when there is no decision recorded yet", async () => {
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/no decision/);
  });

  it("blocks a hold decision from ever sending", async () => {
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [HOLD_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/hold/);
  });

  it("blocks sending a rejection when the latest decision is advance", async () => {
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], [{ ...GOOD_DRAFT, kind: "rejection" }], []];
    const result = await canSend({ candidateId: "c1", kind: "rejection" });
    expect(result.allowed).toBe(false);
  });

  it("blocks sending an invite when the latest decision is decline", async () => {
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [DECLINE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
  });

  it("blocks when no draft of the requested kind exists", async () => {
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], []];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/no invite draft/);
  });

  it("blocks when the draft has already been sent", async () => {
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], [{ ...GOOD_DRAFT, status: "sent" }]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/already been sent/);
  });

  it("blocks when the draft is currently sending (idempotency)", async () => {
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], [{ ...GOOD_DRAFT, status: "sending" }]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
  });

  it("blocks when the draft fails validation (no [NAME])", async () => {
    queue.rows = [
      [{ ...CANDIDATE, firstOpenedAt: new Date() }],
      [ADVANCE_DECISION],
      [{ ...GOOD_DRAFT, bodyTemplate: "Hi there, let's talk." }],
    ];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/validation/);
  });

  it("blocks a low-confidence rejection without the acknowledgement", async () => {
    queue.rows = [
      [{ ...CANDIDATE, firstOpenedAt: new Date() }],
      [DECLINE_DECISION],
      [{ ...GOOD_DRAFT, kind: "rejection" }],
      [{ lowConfidence: true }],
    ];
    const result = await canSend({ candidateId: "c1", kind: "rejection" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/low-confidence/);
  });

  it("allows a low-confidence rejection once acknowledged", async () => {
    shortlistedMock.value = false; // rejection to a not-shortlisted candidate -- no placement contradiction
    queue.rows = [
      [{ ...CANDIDATE, firstOpenedAt: new Date() }],
      [DECLINE_DECISION],
      [{ ...GOOD_DRAFT, kind: "rejection" }],
      [{ lowConfidence: true }],
    ];
    const result = await canSend({ candidateId: "c1", kind: "rejection", acknowledgedLowConfidence: true });
    expect(result.allowed).toBe(true);
  });

  it("blocks live mode without recipient-count confirmation", async () => {
    const prev = process.env.EMAIL_MODE;
    process.env.EMAIL_MODE = "live";
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    process.env.EMAIL_MODE = prev;
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/EMAIL_MODE=live/);
  });

  it("allows live mode once recipient-count is confirmed", async () => {
    const prev = process.env.EMAIL_MODE;
    process.env.EMAIL_MODE = "live";
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite", liveConfirmed: true });
    process.env.EMAIL_MODE = prev;
    expect(result.allowed).toBe(true);
  });

  it("blocks a calibration/test fixture from ever being sent to", async () => {
    queue.rows = [[{ ...CANDIDATE, isCalibration: true }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/calibration/);
  });

  it("the exact incident case: a shortlisted candidate with a rejection draft and an Advance decision is blocked", async () => {
    // Mirrors Sunita Krishnamurthy's trail shape: currently shortlisted
    // (would matter for condition 8), but the decision/kind mismatch at
    // condition 4 blocks it first regardless of placement.
    shortlistedMock.value = true;
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], [{ ...GOOD_DRAFT, kind: "rejection" }]];
    const result = await canSend({ candidateId: "c1", kind: "rejection" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/advance/);
  });

  it("blocks a rejection to a candidate who is currently shortlisted by the algorithm, even though the decision matches the draft kind", async () => {
    // The decision (decline) and draft (rejection) agree with each other --
    // but the shortlist has moved since the decision was made, and nothing
    // else catches that. This is the actual placement-drift gap, distinct
    // from the decision/kind mismatch case above.
    shortlistedMock.value = true;
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [DECLINE_DECISION], [{ ...GOOD_DRAFT, kind: "rejection" }]];
    const result = await canSend({ candidateId: "c1", kind: "rejection" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/shortlisted/);
  });

  it("allows that same rejection once the placement contradiction is explicitly confirmed", async () => {
    shortlistedMock.value = true;
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [DECLINE_DECISION], [{ ...GOOD_DRAFT, kind: "rejection" }]];
    const result = await canSend({ candidateId: "c1", kind: "rejection", placementConfirmed: true });
    expect(result.allowed).toBe(true);
  });

  it("blocks an invite to a candidate who is currently below the shortlist cutoff (symmetric case)", async () => {
    shortlistedMock.value = false;
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite" });
    expect(result.allowed).toBe(false);
    expect(result.reasons.join()).toMatch(/below the shortlist cutoff/);
  });

  it("allows that same invite once the placement contradiction is explicitly confirmed", async () => {
    shortlistedMock.value = false;
    queue.rows = [[{ ...CANDIDATE, firstOpenedAt: new Date() }], [ADVANCE_DECISION], [GOOD_DRAFT]];
    const result = await canSend({ candidateId: "c1", kind: "invite", placementConfirmed: true });
    expect(result.allowed).toBe(true);
  });
});
