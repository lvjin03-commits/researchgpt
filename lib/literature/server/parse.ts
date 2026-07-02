// Server-only module.

import { LiteratureError } from "@/lib/literature/errors";
import { parseDateRangeDays } from "@/lib/literature/date-range";
import {
  DEFAULT_LITERATURE_DISCIPLINE,
  getAvailableSourcesForDiscipline,
  getDefaultSelectedSources,
  getDisciplineSources,
  getSourceName,
  isKnownSourceId,
  isSourceAvailable,
  isValidDisciplineId,
  normalizeSelectedSources,
} from "@/lib/literature/source-taxonomy";
import type { LiteratureDisciplineId } from "@/lib/literature/source-taxonomy";
import type { LiteraturePaperStatus } from "@/lib/literature/types";
import type { LiteratureSettings } from "@/lib/literature/types";

export type ParsedLiteratureSettings = {
  settings: LiteratureSettings;
  ignoredSources: string[];
};

function parseSelectedSources(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function disciplineSourceIds(discipline: LiteratureDisciplineId): string[] {
  return getDisciplineSources(discipline).map((source) => source.id);
}

export type ParseLiteratureSettingsOptions = {
  requireEnabledSources?: boolean;
};

export function parseLiteratureSettings(
  body: unknown,
  options: ParseLiteratureSettingsOptions = {},
): ParsedLiteratureSettings {
  const requireEnabledSources = options.requireEnabledSources ?? true;
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

  const disciplineInput =
    typeof record.discipline === "string" ? record.discipline.trim() : "";
  const discipline = isValidDisciplineId(disciplineInput)
    ? disciplineInput
    : DEFAULT_LITERATURE_DISCIPLINE;

  let requestedSources = parseSelectedSources(record.selectedSources);
  const hasSelectedSourcesField = Array.isArray(record.selectedSources);

  if (requestedSources.length === 0 && record.source === "arxiv") {
    requestedSources = ["arxiv"];
  }

  if (requestedSources.length === 0 && !hasSelectedSourcesField) {
    requestedSources = getDefaultSelectedSources(discipline);
  }

  const validDisciplineSources = new Set(disciplineSourceIds(discipline));
  const inDisciplineSources = requestedSources.filter((sourceId) =>
    validDisciplineSources.has(sourceId),
  );
  const outOfDiscipline = requestedSources.filter(
    (sourceId) => !validDisciplineSources.has(sourceId),
  );

  if (inDisciplineSources.length > 0) {
    requestedSources = inDisciplineSources;
  } else if (outOfDiscipline.length > 0 || requestedSources.length === 0) {
    requestedSources = getDefaultSelectedSources(discipline);
  }

  const unknownSources = requestedSources.filter(
    (sourceId) => !isKnownSourceId(sourceId),
  );

  if (unknownSources.length > 0) {
    throw new LiteratureError(
      `Unknown source(s): ${unknownSources.join(", ")}.`,
      400,
    );
  }

  if (outOfDiscipline.length > 0 && inDisciplineSources.length === 0) {
    const defaults = getDefaultSelectedSources(discipline);
    if (defaults.length === 0) {
      throw new LiteratureError(
        `Source(s) not available for ${discipline}: ${outOfDiscipline.join(", ")}.`,
        400,
      );
    }
  }

  const unsupportedRequested = requestedSources.filter(
    (sourceId) => isKnownSourceId(sourceId) && !isSourceAvailable(sourceId),
  );

  if (unsupportedRequested.length > 0) {
    throw new LiteratureError(
      `Unsupported source(s): ${unsupportedRequested.map(getSourceName).join(", ")}. arXiv and PubMed are available for fetching right now.`,
      400,
    );
  }

  const availableSelected = normalizeSelectedSources(discipline, requestedSources);
  const availableForDiscipline = getAvailableSourcesForDiscipline(discipline).map(
    (source) => source.id,
  );

  if (requireEnabledSources && availableSelected.length === 0) {
    if (availableForDiscipline.length === 0) {
      throw new LiteratureError(
        "No fetchable sources are available for this discipline yet.",
        400,
      );
    }

    throw new LiteratureError(
      `Select at least one available source: ${availableForDiscipline.join(", ")}.`,
      400,
    );
  }

  const dateRangeDays = parseDateRangeDays(record.dateRangeDays);

  if (!keywords) {
    throw new LiteratureError("Keywords are required.", 400);
  }

  return {
    settings: {
      researchDirection,
      keywords,
      excludeKeywords,
      discipline,
      selectedSources: availableSelected,
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

export function parseCategoryName(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("Invalid category body.", 400);
  }

  const name = (body as Record<string, unknown>).name;

  if (typeof name !== "string" || !name.trim()) {
    throw new LiteratureError("Category name is required.", 400);
  }

  return name.trim();
}

export function parsePaperCategoryIds(body: unknown): string[] {
  if (typeof body !== "object" || body === null) {
    throw new LiteratureError("Invalid paper categories body.", 400);
  }

  const categoryIds = (body as Record<string, unknown>).categoryIds;

  if (!Array.isArray(categoryIds)) {
    throw new LiteratureError("categoryIds must be an array.", 400);
  }

  const parsed = categoryIds
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(parsed)];
}
