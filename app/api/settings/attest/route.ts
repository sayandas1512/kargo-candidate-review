import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

export async function POST() {
  await db
    .insert(settings)
    .values({ key: "gemini_billing_attested", value: true })
    .onConflictDoUpdate({ target: settings.key, set: { value: true } });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const [row] = await db.select().from(settings).where(eq(settings.key, "gemini_billing_attested"));
  return NextResponse.json({ attested: Boolean(row?.value) });
}
