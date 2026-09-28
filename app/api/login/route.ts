import { NextRequest, NextResponse } from "next/server";
import { checkPassword, setSessionCookie } from "@/lib/auth";
import { checkLoginRateLimit, recordFailedLoginAttempt, resetLoginAttempts } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  const rate = await checkLoginRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json({ error: "too many attempts, try again later", retryAfterSeconds: rate.retryAfterSeconds }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  const ok = await checkPassword(password);
  if (!ok) {
    await recordFailedLoginAttempt(ip);
    await logAudit({ event: "login.failed", actor: "unknown", meta: { ip } });
    return NextResponse.json({ error: "invalid password" }, { status: 401 });
  }

  await resetLoginAttempts(ip);
  await setSessionCookie();
  await logAudit({ event: "login.success", actor: "arjun", meta: { ip } });
  return NextResponse.json({ ok: true });
}
