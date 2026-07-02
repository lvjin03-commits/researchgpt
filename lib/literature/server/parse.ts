// Server-only module.

import { LiteratureError } from "@/lib/literature/errors";
import type { LiteratureSettings } from "@/lib/literature/types";

export function parseLiteratureSettings(body: unknown): LiteratureSettings {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("Invalid literature settings body.", 400);
  }

  const record = body as Record<string, unknown>;

  const researchDirection =
    typeof record.researchDirection === "string"
      ? record.researchDirection.trim()
      : "";
  const keywords =
    typeof record.keywords === "string" ? record.keywords.trim() : "";
  const excludeKeywords =
    typeof record.excludeKeywords === "string"
      ? record.excludeKeywords.trim()
      : "";
  const source = record.source === "arxiv" ? "arxiv" : "arxiv";
  const dateRangeDays =
    typeof record.dateRangeDays === "number" &&
    Number.isFinite(record.dateRangeDays)
      ? Math.max(1, Math.min(30, Math.round(record.dateRangeDays)))
      : 7;

  if (!keywords) {
    throw new LiteratureError("Keywords are required.", 400);
  }

  return {
    researchDirection,
    keywords,
    excludeKeywords,
    source,
    dateRangeDays,
  };
}

export function parsePaperStatus(body: unknown): "saved" | "skipped" | "read" {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("Invalid paper status body.", 400);
  }

  const status = (body as Record<string, unknown>).status;

  if (status === "saved" || status === "skipped" || status === "read") {
    return status;
  }

  throw new LiteratureError('status must be "saved", "skipped", or "read".', 400);
}
