import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { scoreCandidateAgainstRubric } from "../lib/ai/score";
import { loadRubricSeed } from "./lib/load-rubric";
import { prepareCV } from "./lib/prepare-cv";

type Rating = { file: string; name: string; role: string; rating: "Exceeds" | "Meets" | "Below"; approx_pm_score: number };

async function main() {
  const model = process.env.GEMINI_MODEL;
  if (!model) throw new Error("GEMINI_MODEL is not set");

  const ratingsPath = join(__dirname, "..", "calibration", "ratings.json");
  const { hires } = JSON.parse(readFileSync(ratingsPath, "utf-8")) as { hires: Rating[] };
  const seed = loadRubricSeed();

  const results: { name: string; rating: string; approx: number; actual: number }[] = [];

  for (const hire of hires) {
    const filePath = join(__dirname, "..", "calibration", "hires", hire.file);
    console.log(`Scoring ${hire.name} (${hire.rating})...`);
    const { identity, redacted, scorerInput } = await prepareCV(filePath);
    const result = await scoreCandidateAgainstRubric({
      criteria: seed.PM.criteria,
      doNotReward: seed.global.do_not_reward,
      doNotPenalise: seed.global.do_not_penalise,
      scorerInput,
      redactedText: redacted,
      identity,
      model,
    });
    results.push({ name: hire.name, rating: hire.rating, approx: hire.approx_pm_score, actual: result.weightedTotal });
  }

  results.sort((a, b) => b.actual - a.actual);

  console.log("\nname                  | rating  | approx (rubric.txt) | actual (pipeline)");
  for (const r of results) {
    console.log(`${r.name.padEnd(22)} | ${r.rating.padEnd(7)} | ${String(r.approx).padEnd(20)} | ${r.actual}`);
  }

  const exceedsMin = Math.min(...results.filter((r) => r.rating === "Exceeds").map((r) => r.actual));
  const othersMax = Math.max(...results.filter((r) => r.rating !== "Exceeds").map((r) => r.actual));
  const pass = exceedsMin > othersMax;

  console.log(`\nLowest Exceeds actual score: ${exceedsMin}`);
  console.log(`Highest Meets/Below actual score: ${othersMax}`);
  console.log(pass ? "PASS: every Exceeds outscores every Meets/Below." : "FAIL: order was not reproduced.");
  console.log(
    "\nNote: this is an in-sample sanity check against the same 8 hires the rubric was built from -- a fit check, not validation. Do not expect real applicants to separate this cleanly.",
  );

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
