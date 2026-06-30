// Server-only module. Do not import from client components or /api/chat route entry.

import { UploadError } from "@/lib/uploads/errors";

function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

export async function parsePdfBuffer(buffer: Buffer): Promise<string> {
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
