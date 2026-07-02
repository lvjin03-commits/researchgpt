// Client-only module.

import { normalizeDateRangeDays } from "@/lib/literature/date-range";
import { LiteratureError } from "@/lib/literature/errors";
import {
  getDefaultSelectedSources,
  getDisciplineSources,
  isSourceAvailable,
  isValidDisciplineId,
} from "@/lib/literature/source-taxonomy";
import type {
  LiteraturePaper,
  LiteratureSettings,
  UpdateLiteratureRequest,
  UpdateLiteratureResponse,
} from "@/lib/literature/types";

export { LiteratureError };

export type LiteratureState = {
  settings: LiteratureSettings;
  papers: LiteraturePaper[];
};

async function parseJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new LiteratureError("Invalid literature API response.", response.status);
  }
}

function isLiteratureSettings(value: unknown): value is LiteratureSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.researchDirection === "string" &&
    typeof record.keywords === "string" &&
    typeof record.excludeKeywords === "string" &&
    typeof record.discipline === "string" &&
    isValidDisciplineId(record.discipline) &&
    Array.isArray(record.selectedSources) &&
    record.selectedSources.every((item) => typeof item === "string") &&
    typeof record.dateRangeDays === "number"
  );
}

function isLiteraturePaper(value: unknown): value is LiteraturePaper {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    typeof record.arxivId === "string" &&
    typeof record.title === "string" &&
    typeof record.abstract === "string" &&
    Array.isArray(record.authors) &&
    typeof record.pdfUrl === "string" &&
    typeof record.absUrl === "string" &&
    Array.isArray(record.categories) &&
    typeof record.status === "string" &&
    typeof record.fetchedAt === "string"
  );
}

function parseUpdateLiteratureResponse(payload: unknown): UpdateLiteratureResponse {
  if (typeof payload !== "object" || payload === null) {
    throw new LiteratureError("Invalid literature update response.", 502);
  }

  const record = payload as Record<string, unknown>;

  if (!isLiteratureSettings(record.settings)) {
    throw new LiteratureError("Invalid literature update response.", 502);
  }

  if (!Array.isArray(record.papers) || !record.papers.every(isLiteraturePaper)) {
    throw new LiteratureError("Invalid literature update response.", 502);
  }

  return {
    settings: record.settings,
    papers: record.papers,
  };
}

export function buildUpdateLiteratureRequest(
  settings: LiteratureSettings,
): UpdateLiteratureRequest {
  const disciplineSourceIds = new Set(
    getDisciplineSources(settings.discipline).map((source) => source.id),
  );

  let selectedSources = settings.selectedSources.filter(
    (sourceId) => disciplineSourceIds.has(sourceId) && isSourceAvailable(sourceId),
  );

  if (selectedSources.length === 0) {
    selectedSources = getDefaultSelectedSources(settings.discipline);
  }

  return {
    researchDirection: settings.researchDirection,
    keywords: settings.keywords.trim(),
    excludeKeywords: settings.excludeKeywords,
    discipline: settings.discipline,
    selectedSources,
    dateRangeDays: normalizeDateRangeDays(settings.dateRangeDays),
  };
}

export async function fetchLiteratureState(): Promise<LiteratureState> {
  const response = await fetch("/api/literature");

  const payload = await parseJson<LiteratureState & { error?: string }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to load literature tracker.",
      response.status,
    );
  }

  return {
    settings: payload.settings,
    papers: payload.papers ?? [],
  };
}

export async function saveLiteratureSettings(
  settings: LiteratureSettings,
): Promise<LiteratureSettings> {
  const response = await fetch("/api/literature", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

  const payload = await parseJson<{ settings: LiteratureSettings; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to save literature settings.",
      response.status,
    );
  }

  return payload.settings;
}

export async function updateLiteraturePapers(
  settings: LiteratureSettings,
): Promise<UpdateLiteratureResponse> {
  const requestBody = buildUpdateLiteratureRequest(settings);

  const response = await fetch("/api/literature/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const payload = await parseJson<UpdateLiteratureResponse & { error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to update literature papers.",
      response.status,
    );
  }

  return parseUpdateLiteratureResponse(payload);
}

export async function fetchLiteraturePaper(paperId: string): Promise<LiteraturePaper> {
  const response = await fetch(`/api/literature/papers/${paperId}`);

  const payload = await parseJson<{ paper: LiteraturePaper; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to load literature paper.",
      response.status,
    );
  }

  return payload.paper;
}

export async function updateLiteraturePaperStatus(
  paperId: string,
  status: "saved" | "skipped" | "read",
): Promise<LiteraturePaper> {
  const response = await fetch(`/api/literature/papers/${paperId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

  const payload = await parseJson<{ paper: LiteraturePaper; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to update paper status.",
      response.status,
    );
  }

  return payload.paper;
}
