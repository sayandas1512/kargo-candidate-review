import { describe, it, expect } from "vitest";
import { rankCandidates, highestWeightCriterionKey, type RankableScore } from "@/lib/rank";

describe("highestWeightCriterionKey", () => {
  it("picks the criterion with the largest weight", () => {
    const key = highestWeightCriterionKey([
      { criterion_key: "A", weight: 20 },
      { criterion_key: "B", weight: 30 },
      { criterion_key: "C", weight: 10 },
    ]);
    expect(key).toBe("B");
  });
});

describe("rankCandidates", () => {
  const base = (over: Partial<RankableScore>): RankableScore => ({
    candidateId: "x",
    weightedTotal: 0,
    criteria: [],
    createdAt: new Date("2026-01-01"),
    ...over,
  });

  it("orders by weighted total descending", () => {
    const rows = [base({ candidateId: "a", weightedTotal: 70 }), base({ candidateId: "b", weightedTotal: 90 })];
    const ranked = rankCandidates(rows, "TOP");
    expect(ranked.map((r) => r.candidateId)).toEqual(["b", "a"]);
  });

  it("breaks a tie on the highest-weight criterion score, descending", () => {
    const rows = [
      base({ candidateId: "a", weightedTotal: 80, criteria: [{ criterion_key: "TOP", score: 2 }] }),
      base({ candidateId: "b", weightedTotal: 80, criteria: [{ criterion_key: "TOP", score: 4 }] }),
    ];
    const ranked = rankCandidates(rows, "TOP");
    expect(ranked.map((r) => r.candidateId)).toEqual(["b", "a"]);
  });

  it("breaks a second-level tie on earliest upload time", () => {
    const rows = [
      base({
        candidateId: "later",
        weightedTotal: 80,
        criteria: [{ criterion_key: "TOP", score: 3 }],
        createdAt: new Date("2026-02-01"),
      }),
      base({
        candidateId: "earlier",
        weightedTotal: 80,
        criteria: [{ criterion_key: "TOP", score: 3 }],
        createdAt: new Date("2026-01-01"),
      }),
    ];
    const ranked = rankCandidates(rows, "TOP");
    expect(ranked.map((r) => r.candidateId)).toEqual(["earlier", "later"]);
  });
});
