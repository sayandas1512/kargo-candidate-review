import { NextRequest, NextResponse } from "next/server";
import { runExtractStage } from "@/lib/pipeline/extract";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const candidateId = body?.candidateId;
  if (typeof candidateId !== "string") {
    return NextResponse.json({ error: "candidateId is required" }, { status: 400 });
  }
  try {
    await runExtractStage(candidateId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
