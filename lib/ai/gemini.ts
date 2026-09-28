import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const injectionPatterns = [
  /ignore (all|previous|the) (instructions|prompt)/i,
  /disregard (all|previous|the) (instructions|prompt)/i,
  /system prompt/i,
  /you are now/i,
  /give (this candidate|them|him|her) (a )?(score of )?4/i,
  /score of 4 (on|for) (every|all)/i,
  /new instructions/i,
];

export function detectPromptInjection(text: string): boolean {
  return injectionPatterns.some((re) => re.test(text));
}

export type Identity = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
};

const nameTokenRe = (name: string) =>
  name
    .split(/\s+/)
    .filter((tok) => tok.length >= 3)
    .map((tok) => new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

/**
 * Refuses to let PII reach the model. Must be called on every string sent to
 * Gemini. Throws rather than returning a boolean so a forgotten check can't
 * silently pass PII through.
 */
export function assertNoPII(text: string, identity: Identity): void {
  const checks: RegExp[] = [];
  if (identity.fullName) checks.push(...nameTokenRe(identity.fullName));
  if (identity.email) checks.push(new RegExp(identity.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  if (identity.phone) {
    const digits = identity.phone.replace(/\D/g, "");
    if (digits.length >= 6) checks.push(new RegExp(digits.split("").join("\\D*")));
  }
  for (const re of checks) {
    if (re.test(text)) {
      throw new Error(`assertNoPII: potential identity leak matched ${re}`);
    }
  }
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export type GeminiCallParams<T> = {
  stage: string;
  systemInstruction: string;
  prompt: string;
  schema: z.ZodType<T>;
  responseSchema: Record<string, unknown>;
  identity?: Identity;
  redactedInputs?: string[];
  temperature?: number;
};

/**
 * The ONE wrapper every Gemini call in this app must go through. Refuses to
 * send if PII is detected in any redacted input, validates structured output
 * against a Zod schema, and logs stage/model/duration/ok to audit_log via the
 * caller-supplied logger (kept out of this module so lib/ai/* never imports
 * the DB directly — see the "AI modules never import personal details" rule).
 */
export async function callGemini<T>(params: GeminiCallParams<T>): Promise<{
  data: T;
  raw: string;
  durationMs: number;
}> {
  const { stage, systemInstruction, prompt, schema, responseSchema, identity, redactedInputs, temperature } =
    params;

  for (const text of redactedInputs ?? []) {
    if (identity) assertNoPII(text, identity);
  }

  const model = process.env.GEMINI_MODEL;
  if (!model) throw new Error("GEMINI_MODEL is not set");

  const started = Date.now();
  const ai = getClient();

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: temperature ?? 0,
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const durationMs = Date.now() - started;
  const raw = response.text ?? "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`callGemini[${stage}]: model did not return valid JSON`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`callGemini[${stage}]: schema validation failed: ${result.error.message}`);
  }

  return { data: result.data, raw, durationMs };
}
