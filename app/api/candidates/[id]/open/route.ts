import { NextResponse } from "next/server";
import { db } from "@/db";
import { candidates } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Only set it the first time -- do not overwrite an existing first_opened_at.
  const updated = await db
    .update(candidates)
    .set({ firstOpenedAt: new Date() })
    .where(and(eq(candidates.id, id), isNull(candidates.firstOpenedAt)))
    .returning({ id: candidates.id });

  if (updated.length > 0) {
    await logAudit({ event: "candidate.opened", candidateId: id, actor: "arjun" });
  }
  return NextResponse.json({ ok: true });
}
