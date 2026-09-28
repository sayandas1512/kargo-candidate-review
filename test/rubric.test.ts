import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const seed = JSON.parse(readFileSync(join(__dirname, "..", "rubric.seed.json"), "utf-8"));

describe("rubric weights", () => {
  it.each(["PM", "SPM"] as const)("%s criteria weights sum to exactly 100", (role) => {
    const sum = seed[role].criteria.reduce((acc: number, c: { weight: number }) => acc + c.weight, 0);
    expect(sum).toBe(100);
  });

  it.each(["PM", "SPM"] as const)("%s has no duplicate criterion_key", (role) => {
    const keys = seed[role].criteria.map((c: { criterion_key: string }) => c.criterion_key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(["PM", "SPM"] as const)("%s every criterion has 0/2/4 anchors and a probe", (role) => {
    for (const c of seed[role].criteria) {
      expect(c.anchors["0"]).toBeTruthy();
      expect(c.anchors["2"]).toBeTruthy();
      expect(c.anchors["4"]).toBeTruthy();
      expect(c.probe).toBeTruthy();
    }
  });
});
