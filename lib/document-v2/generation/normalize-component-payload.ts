const MARKDOWN_FENCE = /```(?:[a-z0-9_-]+)?\s*|\s*```/gi;
const ABSTRACT_LABEL = /^(?:abstract|摘要)\s*[:：]?\s*/i;
const TABLE_NUMBER = /^(?:table|表)\s*\d+\s*[|.．:：-]?\s*/i;
const FIGURE_NUMBER = /^(?:fig(?:ure)?\.?|图)\s*\d+\s*[|.．:：-]?\s*/i;

function cleanText(value: unknown): unknown {
  return typeof value === "string"
    ? value.replace(MARKDOWN_FENCE, "").trim()
    : value;
}

export function normalizeGeneratedComponentPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const payload = structuredClone(raw) as Record<string, unknown>;

  if (payload.kind === "title" && typeof payload.title === "string") {
    payload.title = payload.title
      .replace(MARKDOWN_FENCE, "")
      .replace(/\s*\r?\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return payload;
  }

  if (payload.kind !== "blocks") return payload;
  if (Array.isArray(payload.blocks)) {
    payload.blocks = payload.blocks.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return candidate;
      }
      const block = { ...candidate } as Record<string, unknown>;
      block.text = cleanText(block.text);
      block.caption = cleanText(block.caption);
      if (block.role === "abstract" && typeof block.text === "string") {
        block.text = block.text.replace(ABSTRACT_LABEL, "").trim();
      }
      if (block.type === "table" && typeof block.caption === "string") {
        block.caption = block.caption.replace(TABLE_NUMBER, "").trim();
      }
      return block;
    });
  }
  if (Array.isArray(payload.figureRequests)) {
    payload.figureRequests = payload.figureRequests.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return candidate;
      }
      const request = { ...candidate } as Record<string, unknown>;
      for (const field of ["title", "caption", "altText", "contentBrief"]) {
        request[field] = cleanText(request[field]);
      }
      if (typeof request.caption === "string") {
        request.caption = request.caption.replace(FIGURE_NUMBER, "").trim();
      }
      return request;
    });
  }
  return payload;
}
