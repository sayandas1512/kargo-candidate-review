import { createHash } from "node:crypto";
import { extractText } from "unpdf";
import mammoth from "mammoth";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MIN_WORDS = 150;

export type IngestResult =
  | { ok: true; text: string; mime: string }
  | { ok: false; reason: "unsupported_type" | "too_large" | "thin_extraction" };

function sniffMime(bytes: Buffer): "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | null {
  // PDF: starts with %PDF-
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  // DOCX (and any OOXML/zip): starts with PK\x03\x04
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return null;
}

export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validates file content (not just extension), extracts text, and enforces
 * the 150-word minimum. A thin/scanned extraction is NEVER scored -- the
 * caller must route it to needs_manual_review instead.
 */
export async function ingestFile(bytes: Buffer): Promise<IngestResult> {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const mime = sniffMime(bytes);
  if (!mime) {
    return { ok: false, reason: "unsupported_type" };
  }

  let text = "";
  try {
    if (mime === "application/pdf") {
      const { text: pages } = await extractText(new Uint8Array(bytes), { mergePages: true });
      text = pages;
    } else {
      const result = await mammoth.extractRawText({ buffer: bytes });
      text = result.value;
    }
  } catch {
    return { ok: false, reason: "thin_extraction" };
  }

  if (wordCount(text) < MIN_WORDS) {
    return { ok: false, reason: "thin_extraction" };
  }

  return { ok: true, text, mime };
}
