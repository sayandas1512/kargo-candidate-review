import { describe, it, expect, vi } from "vitest";
import { countOpened } from "@/lib/dashboard-metrics";

describe("countOpened", () => {
  it("counts only rows with a non-null firstOpenedAt", () => {
    const rows = [{ firstOpenedAt: new Date() }, { firstOpenedAt: null }, { firstOpenedAt: new Date() }];
    expect(countOpened(rows)).toBe(2);
  });

  it("returns 0 for an empty list", () => {
    expect(countOpened([])).toBe(0);
  });

  it("returns 0 when nothing has been opened", () => {
    expect(countOpened([{ firstOpenedAt: null }, { firstOpenedAt: null }])).toBe(0);
  });
});

describe("getDashboardMetrics", () => {
  it("aggregates reviewed/decisions/drafts from only the rows the (is_calibration=false) query returns", async () => {
    vi.resetModules();
    const candidateRows = [
      { id: "a", firstOpenedAt: new Date("2026-01-01T10:00:00Z") },
      { id: "b", firstOpenedAt: null },
    ];
    const decisionRows = [
      { candidateId: "a" },
      { candidateId: "a" }, // later revision -- still counted, decisionsLogged is a literal row count
    ];
    const draftRows = [{ id: "d1" }];

    const calls = { select: 0 };
    vi.doMock("@/db", () => ({
      db: {
        select: () => {
          calls.select++;
          const n = calls.select;
          return {
            from: () => ({
              where: async () => {
                if (n === 1) return candidateRows;
                if (n === 2) return decisionRows;
                return draftRows;
              },
            }),
          };
        },
      },
    }));

    const { getDashboardMetrics } = await import("@/lib/dashboard-metrics");
    const result = await getDashboardMetrics();

    expect(result.reviewed).toEqual({ opened: 1, total: 2 });
    expect(result.decisionsLogged).toBe(2); // literal count of decision rows, not distinct candidates
    expect(result.draftsAwaitingReview).toBe(1);

    vi.doUnmock("@/db");
  });
});
