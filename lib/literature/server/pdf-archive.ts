// Server-only module.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { LiteratureError } from "@/lib/literature/errors";
import { extractFigureEvidenceFromText } from "@/lib/literature/server/figure-evidence";
import { updateLiteraturePaperPdfArchive } from "@/lib/literature/server/repository";
import type { LiteraturePaper } from "@/lib/literature/types";

const LITERATURE_PDFS_BUCKET = "literature-pdfs";
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_FULL_TEXT_CHARS = 220_000;
const DOWNLOAD_TIMEOUT_MS = 25_000;

function isLikelyPdfUrl(url: string): boolean {
  const normalized = url.toLowerCase();
  return (
    normalized.endsWith(".pdf") ||
    normalized.includes("/pdf/") ||
    normalized.includes("pdf") ||
    normalized.includes("arxiv.org")
  );
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildPdfStoragePath(userId: string, paper: LiteraturePaper): string {
  const digest = createHash("sha1")
    .update(`${paper.id}:${paper.pdfUrl}:${paper.title}`)
    .digest("hex")
    .slice(0, 16);
  const title = sanitizeFilePart(paper.title) || "paper";
  return `${userId}/${paper.id}/${digest}-${title}.pdf`;
}

function createTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
}

async function downloadPdf(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf,*/*;q=0.8",
      "User-Agent":
        "ResearchAI/1.0 (+https://researchgpt.local; literature PDF archive)",
    },
    signal: createTimeoutSignal(),
  });

  if (!response.ok) {
    throw new LiteratureError(`PDF download failed: HTTP ${response.status}`, 502);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PDF_BYTES) {
    throw new LiteratureError("PDF is larger than the storage limit.", 413);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength === 0) {
    throw new LiteratureError("Downloaded PDF is empty.", 422);
  }

  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new LiteratureError("PDF is larger than the storage limit.", 413);
  }

  const hasPdfHeader = buffer.subarray(0, 5).toString("utf8") === "%PDF-";
  if (!hasPdfHeader && !contentType.includes("pdf")) {
    throw new LiteratureError("Downloaded file is not a PDF.", 415);
  }

  return buffer;
}

async function extractPdfFullText(buffer: Buffer): Promise<string | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return normalized ? normalized.slice(0, MAX_FULL_TEXT_CHARS) : null;
  } catch (error) {
    console.warn("[literature] PDF text extraction failed:", error);
    return null;
  }
}

export async function archiveLiteraturePaperPdf(
  supabase: SupabaseClient,
  userId: string,
  paper: LiteraturePaper,
): Promise<LiteraturePaper> {
  const pdfUrl = paper.pdfUrl?.trim();

  if (!pdfUrl || !isLikelyPdfUrl(pdfUrl)) {
    return updateLiteraturePaperPdfArchive(supabase, userId, paper.id, {
      pdfDownloadStatus: "unavailable",
      pdfDownloadError: "No direct PDF URL is available for this paper.",
    });
  }

  try {
    const buffer = await downloadPdf(pdfUrl);
    const storagePath = buildPdfStoragePath(userId, paper);
    const fileName = storagePath.split("/").at(-1) ?? "paper.pdf";
    const fullText = await extractPdfFullText(buffer);
    const figureEvidence = extractFigureEvidenceFromText(fullText, paper);
    const extractedAt = fullText ? new Date().toISOString() : null;

    const { error } = await supabase.storage
      .from(LITERATURE_PDFS_BUCKET)
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (error) {
      throw new LiteratureError(error.message, 500);
    }

    return updateLiteraturePaperPdfArchive(supabase, userId, paper.id, {
      pdfStoragePath: storagePath,
      pdfFileName: fileName,
      pdfFileSize: buffer.byteLength,
      pdfDownloadStatus: "stored",
      pdfDownloadError: null,
      fullText,
      fullTextExtractedAt: extractedAt,
      figureEvidence,
      figureEvidenceExtractedAt: figureEvidence.length > 0 ? extractedAt : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to archive PDF.";
    console.warn("[literature] PDF archive failed:", {
      paperId: paper.id,
      pdfUrl,
      message,
    });

    return updateLiteraturePaperPdfArchive(supabase, userId, paper.id, {
      pdfDownloadStatus: "failed",
      pdfDownloadError: message.slice(0, 500),
    });
  }
}
