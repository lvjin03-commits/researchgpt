export type ExportFormat =
  | "md"
  | "docx"
  | "pdf"
  | "pptx"
  | "xlsx"
  | "svg"
  | "png"
  | "txt"
  | "json";

export type ExportRequest = {
  format: ExportFormat;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type ExportSuccessResponse = {
  success: true;
  filename: string;
  downloadUrl: string;
};

export type ExportErrorResponse = {
  success: false;
  error: string;
};

export type ExportResponse = ExportSuccessResponse | ExportErrorResponse;

export type ExportRecord = {
  id: string;
  filename: string;
  mimeType: string;
  userId: string;
  createdAt: number;
  filePath: string;
};

export const EXPORT_MIME_TYPES: Record<ExportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  svg: "image/svg+xml; charset=utf-8",
  png: "image/png",
};

export const MAX_EXPORT_CONTENT_CHARS = 500_000;
