import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { rubrics } from "../db/schema";
import { eq, and } from "drizzle-orm";

type Criterion = {
  criterion_key: string;
  name: string;
  weight: number;
  measures: string;
  anchors: { "0": string; "2": string; "4": string };
  hire_evidence: string;
  probe: string;
};

type RubricSeed = {
  source: string;
  global: { do_not_reward: string[]; do_not_penalise: string[] };
  PM: { version: number; weights_sum: number; criteria: Criterion[] };
  SPM: { version: number; weights_sum: number; criteria: Criterion[] };
};

function validate(seed: RubricSeed) {
  for (const role of ["PM", "SPM"] as const) {
    const sum = seed[role].criteria.reduce((acc, c) => acc + c.weight, 0);
    if (sum !== 100) {
      throw new Error(`Rubric weights for ${role} sum to ${sum}, not 100. Refusing to seed.`);
    }
    const keys = new Set(seed[role].criteria.map((c) => c.criterion_key));
    if (keys.size !== seed[role].criteria.length) {
      throw new Error(`Duplicate criterion_key in ${role} rubric.`);
    }
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const raw = readFileSync(new URL("../rubric.seed.json", import.meta.url), "utf-8");
  const seed = JSON.parse(raw) as RubricSeed;
  validate(seed);

  const sql = neon(url);
  const db = drizzle(sql);

  for (const role of ["PM", "SPM"] as const) {
    const { version, criteria } = seed[role];
    const payload = criteria.map((c) => ({ ...c, do_not_reward: seed.global.do_not_reward, do_not_penalise: seed.global.do_not_penalise }));

    const existing = await db
      .select()
      .from(rubrics)
      .where(and(eq(rubrics.role, role), eq(rubrics.version, version)));

    if (existing.length === 0) {
      await db.insert(rubrics).values({
        role,
        version,
        criteria: payload,
        source: seed.source,
        isActive: false,
      });
      console.log(`Inserted ${role} v${version}`);
    } else {
      await db
        .update(rubrics)
        .set({ criteria: payload, source: seed.source })
        .where(and(eq(rubrics.role, role), eq(rubrics.version, version)));
      console.log(`Updated ${role} v${version}`);
    }

    // Deactivate other versions, activate this one.
    await db.update(rubrics).set({ isActive: false }).where(eq(rubrics.role, role));
    await db
      .update(rubrics)
      .set({ isActive: true })
      .where(and(eq(rubrics.role, role), eq(rubrics.version, version)));
    console.log(`Activated ${role} v${version}`);
  }

  console.log("Rubric seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
