import { NextRequest, NextResponse } from "next/server";
import { canSend } from "@/lib/canSend";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kind = req.nextUrl.searchParams.get("kind");
  if (kind !== "invite" && kind !== "rejection") {
    return NextResponse.json({ error: "kind must be invite or rejection" }, { status: 400 });
  }
  const result = await canSend({ candidateId: id, kind });
  return NextResponse.json(result);
}
