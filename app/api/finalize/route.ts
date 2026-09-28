import { NextResponse } from "next/server";
import { runFinalizeStage } from "@/lib/pipeline/finalize";

export const maxDuration = 60;

export async function POST() {
  try {
    const result = await runFinalizeStage();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
