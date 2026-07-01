// Server-only module. Do not import from client components or /api/chat route entry.

import {
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_SCANNED_PDF_PAGES,
  SCANNED_PDF_RENDER_FAILED_MESSAGE,
  SCANNED_PDF_RENDER_WIDTH,
} from "@/lib/documents/constants";
import { truncateText } from "@/lib/documents/truncate";
import type { PdfAttachmentResult } from "@/lib/documents/types";
import {
  MAX_PDF_UPLOAD_BYTES,
  MAX_PDF_UPLOAD_MB,
} from "@/lib/uploads/constants";
import { UploadError } from "@/lib/uploads/errors";

const SCANNED_PDF_NO_TEXT_MESSAGE =
  "This PDF has no text layer and is likely scanned. Please export pages as PNG/JPG and attach as images, or upload a text-based PDF.";

function normalizeExtractedText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();
}

function loadCanvasImport() {
  return import("@napi-rs/canvas");
}

function assertPdfSize(buffer: Buffer): void {
  if (buffer.byteLength === 0) {
    throw new UploadError("The uploaded file is empty.");
  }

  if (buffer.byteLength > MAX_PDF_UPLOAD_BYTES) {
    throw new UploadError(
      `File exceeds the ${MAX_PDF_UPLOAD_MB}MB PDF size limit.`,
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

export async function renderScannedPdfPages(
  buffer: Buffer,
  fileName: string,
): Promise<{
  images: { dataUrl: string }[];
  pageNote: string;
}> {
  try {
    const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const totalPages = pdf.numPages;

    if (totalPages === 0) {
      throw new UploadError(SCANNED_PDF_RENDER_FAILED_MESSAGE, 422);
    }

    const pagesToRender = Math.min(totalPages, MAX_SCANNED_PDF_PAGES);
    const images: { dataUrl: string }[] = [];

    for (let pageNumber = 1; pageNumber <= pagesToRender; pageNumber += 1) {
      const dataUrl = await renderPageAsImage(pdf, pageNumber, {
        canvasImport: loadCanvasImport,
        toDataURL: true,
        width: SCANNED_PDF_RENDER_WIDTH,
      });

      if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
        images.push({ dataUrl });
      }
    }

    if (images.length === 0) {
      throw new UploadError(SCANNED_PDF_RENDER_FAILED_MESSAGE, 422);
    }

    let pageNote = `[Note: "${fileName}" appears to be a scanned PDF. Analyzing the first ${pagesToRender} page${pagesToRender === 1 ? "" : "s"} via vision.]`;

    if (totalPages > MAX_SCANNED_PDF_PAGES) {
      pageNote += ` Only the first ${MAX_SCANNED_PDF_PAGES} of ${totalPages} pages were analyzed.`;
    }

    return { images, pageNote };
  } catch (error) {
    if (error instanceof UploadError) {
      throw error;
    }

    throw new UploadError(SCANNED_PDF_RENDER_FAILED_MESSAGE, 422);
  }
}

export async function parsePdfAttachment(
  buffer: Buffer,
  fileName: string,
): Promise<PdfAttachmentResult> {
  assertPdfSize(buffer);

  const extractedText = await extractPdfText(buffer);

  if (extractedText) {
    const truncated = truncateText(extractedText, MAX_EXTRACTED_TEXT_CHARS);

    return {
      kind: "text",
      document: {
        fileName,
        text: truncated.text,
        truncated: truncated.truncated,
        originalLength: truncated.originalLength,
      },
    };
  }

  const scanned = await renderScannedPdfPages(buffer, fileName);

  return {
    kind: "scanned",
    fileName,
    images: scanned.images,
    pageNote: scanned.pageNote,
  };
}

/** Used by parseDocument for text-layer PDFs and diagnostics. */
export async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  const text = await extractPdfText(buffer);

  if (!text) {
    throw new UploadError(SCANNED_PDF_NO_TEXT_MESSAGE, 422);
  }

  return text;
}
