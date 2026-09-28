import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function keyFor(ip: string): string {
  return `login_attempts:${ip}`;
}

type WindowState = { count: number; windowStart: number };

export async function checkLoginRateLimit(ip: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const key = keyFor(ip);
  const now = Date.now();
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  const state = (row?.value as WindowState | undefined) ?? null;

  if (!state || now - state.windowStart > WINDOW_MS) {
    return { allowed: true };
  }
  if (state.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((WINDOW_MS - (now - state.windowStart)) / 1000) };
  }
  return { allowed: true };
}

export async function recordFailedLoginAttempt(ip: string): Promise<void> {
  const key = keyFor(ip);
  const now = Date.now();
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  const state = (row?.value as WindowState | undefined) ?? null;

  const next: WindowState =
    !state || now - state.windowStart > WINDOW_MS ? { count: 1, windowStart: now } : { count: state.count + 1, windowStart: state.windowStart };

  await db
    .insert(settings)
    .values({ key, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next } });
}

export async function resetLoginAttempts(ip: string): Promise<void> {
  const key = keyFor(ip);
  const value: WindowState = { count: 0, windowStart: Date.now() };
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
