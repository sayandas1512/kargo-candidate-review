import { NextRequest, NextResponse } from "next/server";
import { runIngestStage } from "@/lib/pipeline/ingest";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const [attested] = await db.select().from(settings).where(eq(settings.key, "gemini_billing_attested"));
  if (!attested?.value) {
    return NextResponse.json({ error: "gemini_billing_attested is not set; show the privacy attestation first" }, { status: 412 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const appliedRole = form.get("appliedRole");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (appliedRole !== "PM" && appliedRole !== "SPM") {
    return NextResponse.json({ error: "appliedRole must be PM or SPM" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const outcome = await runIngestStage(bytes, file.name, appliedRole);

  switch (outcome.status) {
    case "unsupported_type":
      return NextResponse.json({ error: "only PDF or DOCX files are accepted" }, { status: 415 });
    case "too_large":
      return NextResponse.json({ error: "file exceeds 5 MB" }, { status: 413 });
    default:
      return NextResponse.json({ status: outcome.status, candidateId: "candidateId" in outcome ? outcome.candidateId : undefined });
  }
}
