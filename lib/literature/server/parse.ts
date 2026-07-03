// Server-only module.

import { LiteratureError } from "@/lib/literature/errors";
import { parseDateRangeDays } from "@/lib/literature/date-range";
import { DEFAULT_LITERATURE_PIPELINE_SOURCES } from "@/lib/literature/providers/index";
import { DEFAULT_LITERATURE_DISCIPLINE } from "@/lib/literature/source-taxonomy";
import type { LiteraturePaperStatus } from "@/lib/literature/types";
import type { LiteratureSettings } from "@/lib/literature/types";

export type ParsedLiteratureSettings = {
  settings: LiteratureSettings;
  ignoredSources: string[];
};

export type ParseLiteratureSettingsOptions = {
  requireEnabledSources?: boolean;
};

export function parseLiteratureSettings(
  body: unknown,
  _options: ParseLiteratureSettingsOptions = {},
): ParsedLiteratureSettings {
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

  const dateRangeDays = parseDateRangeDays(record.dateRangeDays);

  if (!keywords) {
    throw new LiteratureError("Keywords are required.", 400);
  }

  return {
    settings: {
      researchDirection,
      keywords,
      excludeKeywords,
      discipline: DEFAULT_LITERATURE_DISCIPLINE,
      selectedSources: [...DEFAULT_LITERATURE_PIPELINE_SOURCES],
      dateRangeDays,
    },
    ignoredSources: [],
  };
}

export function parsePaperStatus(
  body: unknown,
): LiteraturePaperStatus {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("Invalid paper status body.", 400);
  }

  const status = (body as Record<string, unknown>).status;

  if (
    status === "saved" ||
    status === "skipped" ||
    status === "read" ||
    status === "new"
  ) {
    return status;
  }

  throw new LiteratureError(
    'status must be "saved", "skipped", "read", or "new".',
    400,
  );
}

export function parseFolderName(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("Invalid folder body.", 400);
  }

  const name = (body as Record<string, unknown>).name;

  if (typeof name !== "string" || !name.trim()) {
    throw new LiteratureError("Folder name is required.", 400);
  }

  return name.trim();
}

export function parsePersonalNotes(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("Invalid notes body.", 400);
  }

  const notes = (body as Record<string, unknown>).notes;

  if (typeof notes !== "string") {
    throw new LiteratureError("notes must be a string.", 400);
  }

  return notes;
}

export function parsePaperFolderIds(body: unknown): string[] {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("Invalid paper folders body.", 400);
  }

  const folderIds = (body as Record<string, unknown>).folderIds;

  if (!Array.isArray(folderIds)) {
    throw new LiteratureError("folderIds must be an array.", 400);
  }

  const parsed = folderIds
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(parsed)];
}
