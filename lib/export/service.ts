// Server-only module. Do not import from client components or /api/chat route entry.

import { buildExportFilename } from "@/lib/export/filename";
import { ExportError } from "@/lib/export/errors";
import { generateExportBuffer } from "@/lib/export/generators/generate-buffer";
import { saveExport } from "@/lib/export/store";
import {
  EXPORT_MIME_TYPES,
  MAX_EXPORT_CONTENT_CHARS,
  type ExportFormat,
  type ExportRequest,
  type ExportSuccessResponse,
} from "@/lib/export/types";

const EXPORT_FORMATS = new Set<ExportFormat>([
  "md",
  "docx",
  "pdf",
  "pptx",
  "xlsx",
  "svg",
  "png",
  "txt",
  "json",
]);

export function parseExportRequest(body: unknown): ExportRequest {
  if (typeof body !== "object" || body === null) {
    throw new ExportError("Invalid export request body.", 400);
  }

  const record = body as Record<string, unknown>;
  const format = record.format;
  const title = record.title;
  const content = record.content;
  const metadata = record.metadata;

  if (typeof format !== "string" || !EXPORT_FORMATS.has(format as ExportFormat)) {
    throw new ExportError(
      'format must be one of: "docx", "pdf", "pptx", "xlsx", "svg", "png", "md", "txt", "json".',
      400,
    );
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new ExportError("title is required.", 400);
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new ExportError("content is required.", 400);
  }

  if (content.length > MAX_EXPORT_CONTENT_CHARS) {
    throw new ExportError(
      `content exceeds the ${MAX_EXPORT_CONTENT_CHARS.toLocaleString()} character export limit.`,
      413,
    );
  }

  const normalizedMetadata =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};

  return {
    format: format as ExportFormat,
    title: title.trim(),
    content,
    metadata: normalizedMetadata,
  };
}

export async function createExport(
  request: ExportRequest,
  userId: string,
): Promise<ExportSuccessResponse> {
  const filename = buildExportFilename(request.title, request.format);
  const mimeType = EXPORT_MIME_TYPES[request.format];
  const buffer = await generateExportBuffer(request.format, {
    title: request.title,
    content: request.content,
    metadata: request.metadata ?? {},
  });

  const record = await saveExport({
    filename,
    mimeType,
    userId,
    buffer,
  });

  return {
    success: true,
    filename: record.filename,
    downloadUrl: `/api/download/${record.id}`,
  };
}
