const MAX_FILENAME_TITLE_LENGTH = 60;

export function sanitizeFilenameSegment(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    return "export";
  }

  if (normalized.length <= MAX_FILENAME_TITLE_LENGTH) {
    return normalized;
  }

  return normalized.slice(0, MAX_FILENAME_TITLE_LENGTH).replace(/-+$/, "");
}

export function formatExportTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function buildExportFilename(
  title: string,
  extension: string,
): string {
  const safeExtension = extension.replace(/^\./, "");
  return `researchgpt-${sanitizeFilenameSegment(title)}-${formatExportTimestamp()}.${safeExtension}`;
}
