import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "kargo_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

function getSecret(): Uint8Array {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) throw new Error("DASHBOARD_PASSWORD is not set");
  return new TextEncoder().encode(password);
}

export async function createSessionCookie(): Promise<string> {
  const secret = getSecret();
  return new SignJWT({ sub: "arjun" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const secret = getSecret();
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function checkPassword(input: string): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) throw new Error("DASHBOARD_PASSWORD is not set");
  // Constant-time-ish comparison to avoid trivial timing leaks.
  if (input.length !== password.length) return false;
  let diff = 0;
  for (let i = 0; i < password.length; i++) {
    diff |= input.charCodeAt(i) ^ password.charCodeAt(i);
  }
  return diff === 0;
}

export async function setSessionCookie() {
  const token = await createSessionCookie();
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export { COOKIE_NAME };
