import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { join } from "node:path";
import { scoreCandidateAgainstRubric } from "../lib/ai/score";
import { loadRubricSeed } from "./lib/load-rubric";
import { prepareCV } from "./lib/prepare-cv";

const CV_PATH = join(__dirname, "..", "calibration", "hires", "cv_01_rohan_desai.docx");
const RUNS = 3;

async function main() {
  const model = process.env.GEMINI_MODEL;
  if (!model) throw new Error("GEMINI_MODEL is not set");

  console.log(`Scoring ${CV_PATH} against the PM rubric ${RUNS} times...`);
  const { identity, redacted, scorerInput } = await prepareCV(CV_PATH);
  const seed = loadRubricSeed();

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    console.log(`Run ${i + 1}/${RUNS}...`);
    const result = await scoreCandidateAgainstRubric({
      criteria: seed.PM.criteria,
      doNotReward: seed.global.do_not_reward,
      doNotPenalise: seed.global.do_not_penalise,
      scorerInput,
      redactedText: redacted,
      identity,
      model,
    });
    runs.push(result);
  }

  let pass = true;
  console.log("\ncriterion_key | " + runs.map((_, i) => `run${i + 1}`).join(" | ") + " | max_diff");
  for (const c of seed.PM.criteria) {
    const scores = runs.map((r) => r.criteria.find((x) => x.criterion_key === c.criterion_key)!.score);
    const maxDiff = Math.max(...scores) - Math.min(...scores);
    if (maxDiff > 1) pass = false;
    console.log(`${c.criterion_key} | ${scores.join(" | ")} | ${maxDiff}`);
  }

  console.log(pass ? "\nPASS: no criterion differed by more than 1 across runs." : "\nFAIL: at least one criterion differed by more than 1.");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
