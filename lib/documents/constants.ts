// Server-only module. Do not import from client components or /api/chat route entry.

export const MAX_EXTRACTED_TEXT_CHARS = 100_000;

export const SCANNED_PDF_USER_MESSAGE =
  "This PDF appears to be scanned or image-only. Please export the PDF pages as PNG/JPG and upload those images instead.";
