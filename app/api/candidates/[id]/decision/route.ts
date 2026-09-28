import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { decisions } from "@/db/schema";
import { isCandidateShortlisted } from "@/lib/pipeline/finalize";
import { logAudit } from "@/lib/audit";

const VALID_DECISIONS = ["advance", "hold", "decline"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!VALID_DECISIONS.includes(decision)) {
    return NextResponse.json({ error: "decision must be advance, hold, or decline" }, { status: 400 });
  }

  if (decision !== "hold") {
    const shortlisted = await isCandidateShortlisted(id);
    const againstPlacement = (decision === "advance" && !shortlisted) || (decision === "decline" && shortlisted);
    if (againstPlacement && !reason) {
      return NextResponse.json(
        { error: "this decision goes against the system placement; a short reason is required" },
        { status: 400 },
      );
    }
  }

  const [row] = await db
    .insert(decisions)
    .values({ candidateId: id, decision, reason: reason || null, decidedBy: "arjun" })
    .returning({ id: decisions.id });

  await logAudit({ event: "decision.recorded", candidateId: id, actor: "arjun", meta: { decision, decisionId: row.id } });

  return NextResponse.json({ ok: true });
}
