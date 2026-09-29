import { NextResponse } from "next/server";
import { runFinalizeStage } from "@/lib/pipeline/finalize";

// Processes every scored candidate (a brief + a draft generation call each,
// run 3-at-a-time -- see mapWithConcurrency in lib/pipeline/finalize.ts).
// Longer than the per-stage routes' 60s since it can touch many candidates
// in one call, e.g. when the upload queue drains.
export const maxDuration = 300;

export async function POST() {
  try {
    const result = await runFinalizeStage();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
