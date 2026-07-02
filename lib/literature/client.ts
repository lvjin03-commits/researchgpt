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
  LiteratureFolder,
  LiteraturePaper,
  LiteraturePaperStatus,
  LiteratureSettings,
  UpdateLiteratureRequest,
  UpdateLiteratureResponse,
} from "@/lib/literature/types";
import type { LibraryFilters } from "@/lib/literature/library-filters";

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

function validateLiteratureSettings(value: unknown): value is LiteratureSettings {
  if (typeof value !== "object" || value === null) {
    console.error(
      "[literature] update response validation failed: settings invalid (not an object)",
    );
    return false;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.researchDirection !== "string") {
    console.error(
      "[literature] update response validation failed: settings.researchDirection invalid",
    );
    return false;
  }

  if (typeof record.keywords !== "string") {
    console.error(
      "[literature] update response validation failed: settings.keywords invalid",
    );
    return false;
  }

  if (typeof record.excludeKeywords !== "string") {
    console.error(
      "[literature] update response validation failed: settings.excludeKeywords invalid",
    );
    return false;
  }

  if (typeof record.discipline !== "string" || !isValidDisciplineId(record.discipline)) {
    console.error(
      "[literature] update response validation failed: settings.discipline invalid",
    );
    return false;
  }

  if (
    !Array.isArray(record.selectedSources) ||
    !record.selectedSources.every((item) => typeof item === "string")
  ) {
    console.error(
      "[literature] update response validation failed: settings.selectedSources invalid",
    );
    return false;
  }

  if (typeof record.dateRangeDays !== "number") {
    console.error(
      "[literature] update response validation failed: settings.dateRangeDays invalid",
    );
    return false;
  }

  return true;
}

function getLiteraturePaperValidationFailure(
  value: unknown,
  index: number,
): string | null {
  if (typeof value !== "object" || value === null) {
    return `paper[${index}] invalid (not an object)`;
  }

  const record = value as Record<string, unknown>;
  const requiredStringFields = [
    "id",
    "arxivId",
    "title",
    "abstract",
    "pdfUrl",
    "absUrl",
    "status",
    "fetchedAt",
  ] as const;

  for (const field of requiredStringFields) {
    if (typeof record[field] !== "string") {
      return `paper[${index}].${field} invalid`;
    }
  }

  if (!Array.isArray(record.authors)) {
    return `paper[${index}].authors invalid`;
  }

  if (!Array.isArray(record.categories)) {
    return `paper[${index}].categories invalid`;
  }

  return null;
}

async function parseUpdateResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "(none)";

  console.log("[literature] update response status:", response.status);
  console.log("[literature] update response content-type:", contentType);
  console.log("[literature] update response body preview:", text.slice(0, 1000));

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new LiteratureError(
      `Invalid literature API response. status=${response.status}, body=${text.slice(0, 500)}`,
      response.status,
    );
  }
}

function parseUpdateLiteratureResponse(payload: unknown): UpdateLiteratureResponse {
  if (typeof payload !== "object" || payload === null) {
    console.error(
      "[literature] update response validation failed: top-level payload invalid",
    );
    throw new LiteratureError("Invalid literature update response.", 502);
  }

  const record = payload as Record<string, unknown>;

  if (!validateLiteratureSettings(record.settings)) {
    console.error("[literature] update response validation failed: settings invalid");
    throw new LiteratureError("Invalid literature update response.", 502);
  }

  if (!Array.isArray(record.papers)) {
    console.error("[literature] update response validation failed: papers not array");
    throw new LiteratureError("Invalid literature update response.", 502);
  }

  for (let index = 0; index < record.papers.length; index += 1) {
    const failure = getLiteraturePaperValidationFailure(record.papers[index], index);
    if (failure) {
      console.error(`[literature] update response validation failed: ${failure}`);
      throw new LiteratureError("Invalid literature update response.", 502);
    }
  }

  return {
    settings: record.settings,
    papers: record.papers as LiteraturePaper[],
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

  const payload = await parseUpdateResponseBody(response);

  if (!response.ok) {
    const errorPayload =
      typeof payload === "object" && payload !== null
        ? (payload as { error?: string })
        : {};

    throw new LiteratureError(
      errorPayload.error ?? "Failed to update literature papers.",
      response.status,
    );
  }

  return parseUpdateLiteratureResponse(payload);
}

export async function fetchLiteratureLibrary(
  filters: LibraryFilters,
): Promise<{ papers: LiteraturePaper[]; folders: LiteratureFolder[] }> {
  const params = new URLSearchParams();

  params.set("status", filters.status);
  if (filters.q) params.set("q", filters.q);
  if (filters.source) params.set("source", filters.source);
  if (filters.discipline) params.set("discipline", filters.discipline);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.folderId) {
    params.set("folderId", filters.folderId);
  }

  const response = await fetch(`/api/literature/library?${params.toString()}`);
  const payload = await parseJson<{
    papers: LiteraturePaper[];
    folders: LiteratureFolder[];
    error?: string;
  }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to load literature library.",
      response.status,
    );
  }

  return {
    papers: payload.papers ?? [],
    folders: payload.folders ?? [],
  };
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
  status: LiteraturePaperStatus,
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

export async function fetchLiteratureFolders(): Promise<LiteratureFolder[]> {
  const response = await fetch("/api/literature/folders");
  const payload = await parseJson<{ folders: LiteratureFolder[]; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to load folders.",
      response.status,
    );
  }

  return payload.folders ?? [];
}

export async function createLiteratureFolder(name: string): Promise<LiteratureFolder> {
  const response = await fetch("/api/literature/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  const payload = await parseJson<{ folder: LiteratureFolder; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to create folder.",
      response.status,
    );
  }

  return payload.folder;
}

export async function updateLiteratureFolder(
  folderId: string,
  name: string,
): Promise<LiteratureFolder> {
  const response = await fetch(`/api/literature/folders/${folderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  const payload = await parseJson<{ folder: LiteratureFolder; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to update folder.",
      response.status,
    );
  }

  return payload.folder;
}

export async function deleteLiteratureFolder(folderId: string): Promise<void> {
  const response = await fetch(`/api/literature/folders/${folderId}`, {
    method: "DELETE",
  });

  const payload = await parseJson<{ error?: string }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to delete folder.",
      response.status,
    );
  }
}

export async function setPaperFolders(
  paperId: string,
  folderIds: string[],
): Promise<string[]> {
  const response = await fetch(`/api/literature/papers/${paperId}/folders`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderIds }),
  });

  const payload = await parseJson<{ folderIds: string[]; error?: string }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "Failed to update paper folders.",
      response.status,
    );
  }

  return payload.folderIds ?? [];
}
