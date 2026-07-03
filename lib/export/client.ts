// Client-only module. Do not import from API routes.

import { downloadBlob } from "@/lib/export/download";
import { ExportError } from "@/lib/export/errors";
import type { ExportFormat, ExportResponse } from "@/lib/export/types";

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

  let payload: ExportResponse;

  try {
    payload = (await response.json()) as ExportResponse;
  } catch {
    throw new ExportError("导出请求返回无效响应。", response.status);
  }

  if (!response.ok || !payload.success) {
    const message =
      !payload.success && payload.error
        ? payload.error
        : "生成导出文件失败。";
    throw new ExportError(message, response.status);
  }

  const downloadResponse = await fetch(payload.downloadUrl);

  if (!downloadResponse.ok) {
    throw new ExportError("下载导出文件失败。", 502);
  }

  const blob = await downloadResponse.blob();
  downloadBlob(blob, payload.filename);

  return { filename: payload.filename };
}
