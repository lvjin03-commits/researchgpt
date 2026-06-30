// Server-only module. Do not import from client components or /api/chat route entry.

export type TruncateResult = {
  text: string;
  truncated: boolean;
  originalLength: number;
};

export function truncateText(
  text: string,
  maxLength: number,
): TruncateResult {
  if (text.length <= maxLength) {
    return { text, truncated: false, originalLength: text.length };
  }

  let cutPoint = maxLength;
  const searchWindow = Math.min(2_000, maxLength);
  const searchStart = maxLength - searchWindow;
  const slice = text.slice(searchStart, maxLength);
  const lastNewline = slice.lastIndexOf("\n");
  const lastSpace = slice.lastIndexOf(" ");

  if (lastNewline > 0) {
    cutPoint = searchStart + lastNewline;
  } else if (lastSpace > 0) {
    cutPoint = searchStart + lastSpace;
  }

  return {
    text: text.slice(0, cutPoint).trimEnd(),
    truncated: true,
    originalLength: text.length,
  };
}
