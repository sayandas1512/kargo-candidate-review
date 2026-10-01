import { describe, it, expect, vi, beforeEach } from "vitest";

// Proves the decision route wires BOTH against-placement directions to the
// matching draft-kind-swap helper, not just demotion. Found live during the
// B2 audit: promoteCandidate existed but was never called from here.

const shortlistedMock = vi.hoisted(() => ({ value: false }));
const demoteSpy = vi.hoisted(() => vi.fn(async () => {}));
const promoteSpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/pipeline/finalize", () => ({
  isCandidateShortlisted: async () => shortlistedMock.value,
  demoteCandidate: demoteSpy,
  promoteCandidate: promoteSpy,
}));

vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "decision-1" }],
      }),
    }),
  },
}));

const { POST } = await import("@/app/api/candidates/[id]/decision/route");

function jsonRequest(body: unknown) {
  return new Request("https://example.test/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  demoteSpy.mockClear();
  promoteSpy.mockClear();
  shortlistedMock.value = false;
});

describe("decision route: draft-kind-swap wiring", () => {
  it("calls demoteCandidate when declining a currently-shortlisted candidate", async () => {
    shortlistedMock.value = true;
    const res = await POST(jsonRequest({ decision: "decline", reason: "test" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(demoteSpy).toHaveBeenCalledWith("c1");
    expect(promoteSpy).not.toHaveBeenCalled();
  });

  it("calls promoteCandidate when advancing a candidate currently below the cutoff (the gap found in B2)", async () => {
    shortlistedMock.value = false;
    const res = await POST(jsonRequest({ decision: "advance", reason: "test" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(promoteSpy).toHaveBeenCalledWith("c1");
    expect(demoteSpy).not.toHaveBeenCalled();
  });

  it("calls neither helper for a decline that already matches placement (not shortlisted)", async () => {
    shortlistedMock.value = false;
    const res = await POST(jsonRequest({ decision: "decline" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(demoteSpy).not.toHaveBeenCalled();
    expect(promoteSpy).not.toHaveBeenCalled();
  });

  it("calls neither helper for an advance that already matches placement (shortlisted)", async () => {
    shortlistedMock.value = true;
    const res = await POST(jsonRequest({ decision: "advance" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(demoteSpy).not.toHaveBeenCalled();
    expect(promoteSpy).not.toHaveBeenCalled();
  });

  it("calls neither helper for a hold", async () => {
    const res = await POST(jsonRequest({ decision: "hold" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(demoteSpy).not.toHaveBeenCalled();
    expect(promoteSpy).not.toHaveBeenCalled();
  });

  it("requires a reason for an against-placement advance, and never calls promoteCandidate without one", async () => {
    shortlistedMock.value = false;
    const res = await POST(jsonRequest({ decision: "advance" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(400);
    expect(promoteSpy).not.toHaveBeenCalled();
  });
});
