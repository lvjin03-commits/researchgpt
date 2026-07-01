// Server-only module. Do not import from client components or /api/chat route entry.

import {
  MAX_EXTRACTED_TEXT_CHARS,
  SCANNED_PDF_USER_MESSAGE,
} from "@/lib/documents/constants";
import { truncateText } from "@/lib/documents/truncate";
import type { ParsedDocument } from "@/lib/documents/types";
import {
  MAX_UPLOAD_BYTES,
} from "@/lib/uploads/constants";
import { UploadError } from "@/lib/uploads/errors";

function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function assertPdfSize(buffer: Buffer): void {
  if (buffer.byteLength === 0) {
    throw new UploadError("The uploaded file is empty.");
  }

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB size limit.`,
      413,
    );
  }
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");

    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n\n") : text;

    return normalizeExtractedText(merged);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown PDF parsing error";

    throw new UploadError(`Failed to parse PDF: ${reason}`, 422);
  }
}

export async function parsePdfAttachment(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedDocument> {
  assertPdfSize(buffer);

  const extractedText = await extractPdfText(buffer);

  if (!extractedText) {
    throw new UploadError(SCANNED_PDF_USER_MESSAGE, 422);
  }

  const truncated = truncateText(extractedText, MAX_EXTRACTED_TEXT_CHARS);

  return {
    fileName,
    text: truncated.text,
    truncated: truncated.truncated,
    originalLength: truncated.originalLength,
  };
}

/** Used by parseDocument for text-layer PDFs and diagnostics. */
export async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  const text = await extractPdfText(buffer);

  if (!text) {
    throw new UploadError(SCANNED_PDF_USER_MESSAGE, 422);
  }

  return text;
}
