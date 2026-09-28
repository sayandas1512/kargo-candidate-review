import { describe, it, expect } from "vitest";
import { computeWeightedTotal } from "@/lib/scoring-math";

describe("computeWeightedTotal", () => {
  it("computes sum(weight * score / 4) rounded to 1 decimal", () => {
    const criteria = [
      { criterion_key: "PM-1", weight: 30 },
      { criterion_key: "PM-2", weight: 25 },
      { criterion_key: "PM-3", weight: 20 },
      { criterion_key: "PM-4", weight: 15 },
      { criterion_key: "PM-5", weight: 10 },
    ];
    const results = [
      { criterion_key: "PM-1", score: 4 },
      { criterion_key: "PM-2", score: 4 },
      { criterion_key: "PM-3", score: 3 },
      { criterion_key: "PM-4", score: 2 },
      { criterion_key: "PM-5", score: 2 },
    ];
    // 30*1 + 25*1 + 20*0.75 + 15*0.5 + 10*0.5 = 30+25+15+7.5+5 = 82.5
    expect(computeWeightedTotal(criteria, results)).toBe(82.5);
  });

  it("treats a missing criterion result as score 0", () => {
    const criteria = [{ criterion_key: "A", weight: 100 }];
    expect(computeWeightedTotal(criteria, [])).toBe(0);
  });

  it("a perfect score on all criteria totals 100", () => {
    const criteria = [
      { criterion_key: "A", weight: 60 },
      { criterion_key: "B", weight: 40 },
    ];
    const results = [
      { criterion_key: "A", score: 4 },
      { criterion_key: "B", score: 4 },
    ];
    expect(computeWeightedTotal(criteria, results)).toBe(100);
  });
});
