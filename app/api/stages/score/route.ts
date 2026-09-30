import { NextRequest, NextResponse } from "next/server";
import { runScoreStage } from "@/lib/pipeline/score";

// Scores against BOTH the PM and SPM rubrics, each a 2-pass grounded call
// with an occasional retry when a criterion doesn't ground on the first
// try -- observed live taking longer than 60s and hitting the platform
// timeout, which the client saw as a raw (non-JSON) error page. Longer
// than the other per-candidate stage routes for that reason.
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const candidateId = body?.candidateId;
  if (typeof candidateId !== "string") {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }
  try {
    await runScoreStage(candidateId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
