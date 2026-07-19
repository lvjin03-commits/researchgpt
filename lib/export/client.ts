// Client-only module. Do not import from API routes.

import { downloadBlob } from "@/lib/export/download";
import { ExportError } from "@/lib/export/errors";
import type { ExportFormat } from "@/lib/export/types";

export { ExportError };

export type ExportContentRequest = {
  format: ExportFormat;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export async function exportContent(
  request: ExportContentRequest,
): Promise<{ filename: string }> {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      format: request.format,
      title: request.title,
      content: request.content,
      metadata: request.metadata ?? {},
    }),
  });

  if (!response.ok) {
    let message = "生成导出文件失败。";
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error ?? message;
    } catch {
      // Keep the user-facing fallback when a proxy returns a non-JSON error.
    }
    throw new ExportError(message, response.status);
  }

  const encodedFilename = response.headers.get("X-Export-Filename");
  const filename = encodedFilename
    ? decodeURIComponent(encodedFilename)
    : `researchgpt-export.${request.format}`;
  const blob = await response.blob();
  downloadBlob(blob, filename);

  return { filename };
}
