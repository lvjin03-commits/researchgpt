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

function buildPdfStoragePath(
  userId: string,
  paper: LiteraturePaper,
  originalFileName?: string,
): string {
  const digest = createHash("sha1")
    .update(`${paper.id}:${paper.pdfUrl}:${paper.title}`)
    .digest("hex")
    .slice(0, 16);
  const fileBase = originalFileName
    ? originalFileName.replace(/\.pdf$/i, "")
    : paper.title;
  const title = sanitizeFilePart(fileBase) || "paper";
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
        "ResearchGPT/1.0 (+https://researchgpt.local; literature PDF archive)",
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

function assertPdfBuffer(buffer: Buffer): void {
  if (buffer.byteLength === 0) {
    throw new LiteratureError("Uploaded PDF is empty.", 422);
  }

  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new LiteratureError("PDF is larger than the storage limit.", 413);
  }

  const hasPdfHeader = buffer.subarray(0, 5).toString("utf8") === "%PDF-";
  if (!hasPdfHeader) {
    throw new LiteratureError("Uploaded file is not a valid PDF.", 415);
  }
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

export async function downloadStoredPdfBuffer(
  supabase: SupabaseClient,
  userId: string,
  paper: LiteraturePaper,
): Promise<{ buffer: Buffer; storagePath: string; fileName: string }> {
  const bucket = supabase.storage.from(LITERATURE_PDFS_BUCKET);
  const candidatePaths: string[] = [];

  if (paper.pdfStoragePath) {
    candidatePaths.push(paper.pdfStoragePath);
  }

  const folderPath = `${userId}/${paper.id}`;
  const { data: storedFiles, error: listError } = await bucket.list(folderPath, {
    limit: 100,
    sortBy: { column: "updated_at", order: "desc" },
  });

  if (!listError) {
    for (const file of storedFiles ?? []) {
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const path = `${folderPath}/${file.name}`;
        if (!candidatePaths.includes(path)) {
          candidatePaths.push(path);
        }
      }
    }
  }

  for (const storagePath of candidatePaths) {
    const { data, error } = await bucket.download(storagePath);
    if (!error && data) {
      return {
        buffer: Buffer.from(await data.arrayBuffer()),
        storagePath,
        fileName: paper.pdfFileName || storagePath.split("/").at(-1) || "paper.pdf",
      };
    }
  }

  if (listError) {
    throw new LiteratureError(
      `无法读取《${paper.title}》的 PDF 存储目录：${listError.message}`,
      500,
    );
  }

  throw new LiteratureError(
    `未找到《${paper.title}》已上传的 PDF 文件，请重新上传。`,
    422,
  );
}

export async function ensureLiteraturePaperFullText(
  supabase: SupabaseClient,
  userId: string,
  paper: LiteraturePaper,
): Promise<LiteraturePaper> {
  if (paper.fullText?.trim()) {
    return paper;
  }

  const { buffer, storagePath, fileName } = await downloadStoredPdfBuffer(
    supabase,
    userId,
    paper,
  );
  assertPdfBuffer(buffer);

  const fullText = await extractPdfFullText(buffer);
  if (!fullText) {
    throw new LiteratureError(
      `《${paper.title}》的 PDF 没有可提取文字，可能是扫描版或加密文件，请上传可复制文字的 PDF。`,
      422,
    );
  }

  const extractedAt = new Date().toISOString();
  const figureEvidence = extractFigureEvidenceFromText(fullText, paper);

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
}

async function storeLiteraturePaperPdfBuffer(
  supabase: SupabaseClient,
  userId: string,
  paper: LiteraturePaper,
  buffer: Buffer,
  originalFileName?: string,
): Promise<LiteraturePaper> {
  assertPdfBuffer(buffer);

  const storagePath = buildPdfStoragePath(userId, paper, originalFileName);
  const fileName = originalFileName?.trim() || storagePath.split("/").at(-1) || "paper.pdf";

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
    fullText: null,
    fullTextExtractedAt: null,
    figureEvidence: [],
    figureEvidenceExtractedAt: null,
  });
}

export async function archiveUploadedLiteraturePaperPdf(
  supabase: SupabaseClient,
  userId: string,
  paper: LiteraturePaper,
  file: File,
): Promise<LiteraturePaper> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return storeLiteraturePaperPdfBuffer(
    supabase,
    userId,
    paper,
    buffer,
    file.name || undefined,
  );
}

export async function registerUploadedLiteraturePaperPdf(
  supabase: SupabaseClient,
  userId: string,
  paper: LiteraturePaper,
  input: { storagePath: string; fileName: string; fileSize: number },
): Promise<LiteraturePaper> {
  if (!input.storagePath.startsWith(`${userId}/`)) {
    throw new LiteratureError("Invalid PDF storage path.", 403);
  }
  if (!input.storagePath.toLowerCase().endsWith(".pdf")) {
    throw new LiteratureError("Uploaded file must be a PDF.", 415);
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0 || input.fileSize > MAX_PDF_BYTES) {
    throw new LiteratureError("PDF size is invalid or exceeds 50 MB.", 413);
  }

  return updateLiteraturePaperPdfArchive(supabase, userId, paper.id, {
    pdfStoragePath: input.storagePath,
    pdfFileName: input.fileName,
    pdfFileSize: input.fileSize,
    pdfDownloadStatus: "stored",
    pdfDownloadError: null,
    fullText: null,
    fullTextExtractedAt: null,
    figureEvidence: [],
    figureEvidenceExtractedAt: null,
  });
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
    return storeLiteraturePaperPdfBuffer(supabase, userId, paper, buffer);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to archive PDF.";
    console.warn("[literature] PDF archive failed:", {
      paperId: paper.id,
      pdfUrl,
      message,
    });

    const pdfDownloadError = message.slice(0, 500);

    try {
      return await updateLiteraturePaperPdfArchive(supabase, userId, paper.id, {
        pdfDownloadStatus: "failed",
        pdfDownloadError,
      });
    } catch (updateError) {
      console.warn("[literature] failed to record PDF archive failure:", {
        paperId: paper.id,
        message:
          updateError instanceof Error
            ? updateError.message
            : "Failed to record archive failure.",
      });

      return {
        ...paper,
        pdfDownloadStatus: "failed",
        pdfDownloadError,
      };
    }
  }
}
