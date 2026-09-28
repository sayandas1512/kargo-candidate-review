import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const AI_DIR = join(__dirname, "..", "lib", "ai");

describe("lib/ai modules never import personal details", () => {
  const files = readdirSync(AI_DIR).filter((f) => f.endsWith(".ts"));

  it("found the lib/ai directory and files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} does not import candidatePersonalDetails or query it`, () => {
      const contents = readFileSync(join(AI_DIR, file), "utf-8");
      expect(contents).not.toMatch(/candidatePersonalDetails/);
      expect(contents).not.toMatch(/candidate_personal_details/);
      // lib/ai/* must also never import the db client directly -- identity
      // is passed in by the caller (see lib/pipeline/*), not fetched here.
      expect(contents).not.toMatch(/from ["']@\/db["']/);
    });
  }
});
