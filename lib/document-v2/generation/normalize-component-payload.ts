const MARKDOWN_FENCE = /```(?:[a-z0-9_-]+)?\s*|\s*```/gi;
const ABSTRACT_LABEL = /^(?:abstract|摘要)\s*[:：]?\s*/i;
const TABLE_NUMBER = /^(?:table|表)\s*\d+\s*[|.．:：-]?\s*/i;
const FIGURE_NUMBER = /^(?:fig(?:ure)?\.?|图)\s*\d+\s*[|.．:：-]?\s*/i;

function cleanText(value: unknown): unknown {
  return typeof value === "string"
    ? value.replace(MARKDOWN_FENCE, "").trim()
    : value;
}

function pick(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((field) => source[field] !== undefined)
      .map((field) => [field, source[field]]),
  );
}

export type ExpectedGeneratedComponentKind =
  | "title"
  | "blocks"
  | "references";

export function normalizeGeneratedComponentPayload(
  raw: unknown,
  expectedKind?: ExpectedGeneratedComponentKind,
): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const source = structuredClone(raw) as Record<string, unknown>;
  // The Document Plan already owns the component type. `kind` is an internal
  // wire discriminator, so it is safe for the program to inject it when the
  // model omits it. Conflicting model output is preserved for strict rejection.
  if (source.kind === undefined && expectedKind) {
    source.kind = expectedKind;
  }

  if (source.kind === "title" && typeof source.title === "string") {
    const payload = pick(source, ["kind", "title"]);
    payload.title = source.title
      .replace(MARKDOWN_FENCE, "")
      .replace(/\s*\r?\n+\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return payload;
  }

  if (source.kind === "references") {
    return pick(source, ["kind", "referenceIds"]);
  }
  if (source.kind !== "blocks") return source;
  const payload = pick(source, ["kind", "blocks", "figureRequests"]);
  if (Array.isArray(source.blocks)) {
    payload.blocks = source.blocks.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return candidate;
      }
      const rawBlock = candidate as Record<string, unknown>;
      const fields =
        rawBlock.type === "heading"
          ? ["type", "level", "text"]
          : rawBlock.type === "paragraph"
            ? [
                "type",
                "role",
                "text",
                "citationIds",
                "figureRequestIndexes",
              ]
            : rawBlock.type === "keywords"
              ? ["type", "values"]
              : rawBlock.type === "table"
                ? ["type", "caption", "columns", "rows"]
                : Object.keys(rawBlock);
      const block = pick(rawBlock, fields);
      if (block.text !== undefined) block.text = cleanText(block.text);
      if (block.caption !== undefined) {
        block.caption = cleanText(block.caption);
      }
      if (block.role === "abstract" && typeof block.text === "string") {
        block.text = block.text.replace(ABSTRACT_LABEL, "").trim();
      }
      if (block.type === "table" && typeof block.caption === "string") {
        block.caption = block.caption.replace(TABLE_NUMBER, "").trim();
      }
      return block;
    });
  }
  if (Array.isArray(source.figureRequests)) {
    payload.figureRequests = source.figureRequests.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        return candidate;
      }
      const request = pick(candidate as Record<string, unknown>, [
        "slotId",
        "figureType",
        "title",
        "caption",
        "altText",
        "contentBrief",
        "placementAfterBlockIndex",
        "sourceEvidenceIds",
      ]);
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
