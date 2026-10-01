import { describe, it, expect, vi, beforeEach } from "vitest";

// Both send routes must refuse to ever reach Resend when canSend blocks --
// this is the direct "both routes respect the one gate, no exceptions" proof,
// reproducing the exact incident shape (a blocked send) at the route level
// rather than just the lib/canSend.ts unit level.

type CanSendResult = { allowed: boolean; reasons: string[]; draftId?: string };
const canSendMock = vi.hoisted(() => ({ result: { allowed: false, reasons: ["blocked for test"] } as CanSendResult }));
vi.mock("@/lib/canSend", () => ({ canSend: async () => canSendMock.result }));

const resendSendSpy = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSendSpy };
  },
}));

vi.mock("@/lib/audit", () => ({ logAudit: async () => {} }));
vi.mock("@/lib/email-format", () => ({ textToEmailHtml: (s: string) => s }));

const dbMock = vi.hoisted(() => ({
  updateResult: [] as unknown[],
}));
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => dbMock.updateResult,
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => [],
      }),
    }),
  },
}));

const { POST: singleSend } = await import("@/app/api/candidates/[id]/send/route");
const { POST: bulkSend } = await import("@/app/api/send/bulk/route");

function jsonRequest(body: unknown) {
  return new Request("https://example.test/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  resendSendSpy.mockClear();
  canSendMock.result = { allowed: false, reasons: ["blocked for test"] };
  dbMock.updateResult = [];
});

describe("single-candidate send route respects the gate", () => {
  it("never calls Resend when canSend blocks (the exact incident shape: shortlisted + rejection draft + advance decision)", async () => {
    canSendMock.result = {
      allowed: false,
      reasons: ["latest decision is advance, which requires an invite draft, not rejection"],
    };
    const res = await singleSend(jsonRequest({ kind: "rejection" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(409);
    expect(resendSendSpy).not.toHaveBeenCalled();
  });

  it("never calls Resend for a calibration candidate", async () => {
    canSendMock.result = { allowed: false, reasons: ["candidate is a calibration/test fixture, never sendable"] };
    const res = await singleSend(jsonRequest({ kind: "invite" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(409);
    expect(resendSendSpy).not.toHaveBeenCalled();
  });

  it("proceeds to claim the draft only when canSend allows", async () => {
    canSendMock.result = { allowed: true, reasons: [], draftId: "d1" };
    dbMock.updateResult = []; // claim query returns nothing -> route must stop before Resend too
    const res = await singleSend(jsonRequest({ kind: "invite" }), { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(409); // "already being sent or was already sent"
    expect(resendSendSpy).not.toHaveBeenCalled();
  });
});

describe("bulk send route respects the gate", () => {
  it("never calls Resend for any candidate when canSend blocks every one of them (the incident shape)", async () => {
    canSendMock.result = {
      allowed: false,
      reasons: ["latest decision is advance, which requires an invite draft, not rejection"],
    };
    const res = await bulkSend(
      jsonRequest({ candidateIds: ["c1", "c2"], confirmation: "SEND 2" }),
    );
    const body = await res.json();
    expect(body.sent).toEqual([]);
    expect(body.skipped).toHaveLength(2);
    expect(resendSendSpy).not.toHaveBeenCalled();
  });

  it("never calls Resend for a calibration candidate even if included in the bulk list", async () => {
    canSendMock.result = { allowed: false, reasons: ["candidate is a calibration/test fixture, never sendable"] };
    const res = await bulkSend(jsonRequest({ candidateIds: ["c1"], confirmation: "SEND 1" }));
    const body = await res.json();
    expect(body.sent).toEqual([]);
    expect(resendSendSpy).not.toHaveBeenCalled();
  });

  it("requires the exact SEND N confirmation string before even calling the gate", async () => {
    const res = await bulkSend(jsonRequest({ candidateIds: ["c1"], confirmation: "wrong" }));
    expect(res.status).toBe(400);
    expect(resendSendSpy).not.toHaveBeenCalled();
  });
});
