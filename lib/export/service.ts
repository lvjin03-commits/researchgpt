// Server-only module. Do not import from client components or /api/chat route entry.

import { buildExportFilename } from "@/lib/export/filename";
import { prepareExportPayload } from "@/lib/export/content-sanitize";
import { ExportError } from "@/lib/export/errors";
import { generateExportBuffer } from "@/lib/export/generators/generate-buffer";
import { assertExportQuality } from "@/lib/export/quality";
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

function extractFencedBlocks(content: string): Array<{ language: string; body: string }> {
  const blocks: Array<{ language: string; body: string }> = [];
  const pattern = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g;
  for (const match of content.matchAll(pattern)) {
    const body = match[2]?.trim();
    if (body) {
      blocks.push({ language: (match[1] ?? "").toLowerCase(), body });
    }
  }
  return blocks;
}

function normalizeArtifactContent(format: ExportFormat, content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const fenced = extractFencedBlocks(normalized);

  if (format === "xlsx") {
    const tabular = fenced.find((block) =>
      /^(json|csv|tsv|xlsx|excel)$/i.test(block.language),
    );
    if (tabular) return tabular.body;
  }

  if (format === "docx" || format === "pdf" || format === "md") {
    const markdown = fenced.find((block) =>
      /^(markdown|md)$/i.test(block.language),
    );
    if (markdown) return markdown.body;
  }

  if (format === "txt") {
    const text = fenced.find((block) => /^(text|txt)$/i.test(block.language));
    if (text) return text.body;
  }

  const withoutPlan = normalized.replace(
    /\[\[RESEARCHGPT_PLAN:[\s\S]*?\]\]\s*/g,
    "",
  );
  const withoutFooter = withoutPlan.replace(
    /\n-{3,}\n\s*已生成可下载文件：[\s\S]*$/u,
    "",
  );
  const firstHeading = withoutFooter.search(/^#{1,3}\s+/m);
  if (firstHeading > 0) {
    return withoutFooter.slice(firstHeading).trim();
  }

  return withoutFooter.trim();
}

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
  const prepared = prepareExportPayload({
    title: request.title,
    content: request.content,
    format: request.format,
  });
  const filename = buildExportFilename(prepared.title, request.format);
  const mimeType = EXPORT_MIME_TYPES[request.format];
  const content = normalizeArtifactContent(request.format, prepared.content);
  const buffer = await generateExportBuffer(request.format, {
    title: prepared.title,
    content,
    metadata: request.metadata ?? {},
  });
  assertExportQuality(request.format, buffer);

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
