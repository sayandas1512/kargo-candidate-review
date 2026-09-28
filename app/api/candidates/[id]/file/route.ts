import { NextResponse } from "next/server";
import { db } from "@/db";
import { candidateFiles, candidatePersonalDetails } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [file] = await db.select().from(candidateFiles).where(eq(candidateFiles.candidateId, id));
  if (!file) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const [details] = await db.select().from(candidatePersonalDetails).where(eq(candidatePersonalDetails.candidateId, id));

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename="${(details?.originalFilename ?? "cv").replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
