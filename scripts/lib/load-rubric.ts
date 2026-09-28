import { readFileSync } from "node:fs";
import type { RubricCriterionForScoring } from "../../lib/ai/score";

export function loadRubricSeed(): {
  global: { do_not_reward: string[]; do_not_penalise: string[] };
  PM: { version: number; criteria: RubricCriterionForScoring[] };
  SPM: { version: number; criteria: RubricCriterionForScoring[] };
} {
  const raw = readFileSync(new URL("../../rubric.seed.json", import.meta.url), "utf-8");
  return JSON.parse(raw);
}
