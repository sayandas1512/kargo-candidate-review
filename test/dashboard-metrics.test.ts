import { describe, it, expect, vi } from "vitest";
import { medianReviewMinutes, countOpened } from "@/lib/dashboard-metrics";

describe("medianReviewMinutes", () => {
  it("returns null for an empty list", () => {
    expect(medianReviewMinutes([])).toBeNull();
  });

  it("returns the middle value for an odd-length list, in whole minutes", () => {
    // 3m, 5m, 10m -> median 5m
    expect(medianReviewMinutes([3 * 60_000, 10 * 60_000, 5 * 60_000])).toBe(5);
  });

  it("averages the two middle values for an even-length list", () => {
    // 2m, 4m, 6m, 8m -> median (4+6)/2 = 5m
    expect(medianReviewMinutes([8 * 60_000, 2 * 60_000, 6 * 60_000, 4 * 60_000])).toBe(5);
  });

  it("rounds to the nearest whole minute", () => {
    // single value of 90 seconds -> 1.5m, rounds to 2m
    expect(medianReviewMinutes([90_000])).toBe(2);
  });

  it("is not affected by input order", () => {
    const a = medianReviewMinutes([1, 5, 3, 9, 7].map((m) => m * 60_000));
    const b = medianReviewMinutes([9, 1, 7, 3, 5].map((m) => m * 60_000));
    expect(a).toBe(b);
  });
});

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
  it("aggregates reviewed/median/decisions/drafts from only the rows the (is_calibration=false) query returns", async () => {
    vi.resetModules();
    const candidateRows = [
      { id: "a", firstOpenedAt: new Date("2026-01-01T10:00:00Z") },
      { id: "b", firstOpenedAt: null },
    ];
    const decisionRows = [
      { candidateId: "a", decidedAt: new Date("2026-01-01T10:10:00Z") }, // 10m after open
      { candidateId: "a", decidedAt: new Date("2026-01-01T11:00:00Z") }, // later revision -- ignored, first decision wins
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
    expect(result.medianReviewMinutes).toBe(10); // first decision for "a" is 10m after open, not the 11:00 revision
    expect(result.decisionsLogged).toBe(2); // literal count of decision rows, not distinct candidates
    expect(result.draftsAwaitingReview).toBe(1);

    vi.doUnmock("@/db");
  });
});
