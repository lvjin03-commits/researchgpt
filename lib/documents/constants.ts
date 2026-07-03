// Server-only module. Do not import from client components or /api/chat route entry.

export const MAX_EXTRACTED_TEXT_CHARS = 100_000;

export const SCANNED_PDF_USER_MESSAGE =
  "该 PDF 似乎是扫描件或仅含图片。请将 PDF 页面导出为 PNG/JPG 后上传图片。";
