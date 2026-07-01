// Server-only module. Do not import from client components or /api/chat route entry.

export const MAX_EXTRACTED_TEXT_CHARS = 100_000;

/** Max PDF pages rendered as images when no text layer is found. */
export const MAX_SCANNED_PDF_PAGES = 3;

/** Render width for scanned PDF page images (keeps vision payload size reasonable). */
export const SCANNED_PDF_RENDER_WIDTH = 1200;

export const SCANNED_PDF_RENDER_FAILED_MESSAGE =
  "This PDF appears to be scanned. Please export pages as PNG/JPG and upload them as images.";
