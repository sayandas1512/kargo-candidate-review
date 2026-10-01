import { NextRequest, NextResponse } from "next/server";
import { runExtractStage } from "@/lib/pipeline/extract";
import { runScoreStage } from "@/lib/pipeline/score";

// Chains straight into scoring on success instead of making the upload
// client round-trip back for a separate /api/stages/score call -- extract
// and score are already strictly sequential (score needs extract's output),
// so the two were always going to run back to back; doing it in one function
// invocation saves a full client<->server hop per candidate. Matches score's
// own timeout budget since this route now covers both stages.
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const candidateId = body?.candidateId;
  if (typeof candidateId !== "string") {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }
  try {
    await runExtractStage(candidateId);
  } catch (err) {
    return NextResponse.json({ error: `extract failed: ${String(err)}` }, { status: 500 });
  }
  try {
    await runScoreStage(candidateId);
  } catch (err) {
    return NextResponse.json({ error: `score failed: ${String(err)}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, scored: true });
}
