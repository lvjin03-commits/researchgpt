// Client-only module.

import { normalizeDateRangeDays } from "@/lib/literature/date-range";
import { LiteratureError } from "@/lib/literature/errors";
import { isValidDisciplineId } from "@/lib/literature/source-taxonomy";
import type {
  LiteratureFolder,
  LiteraturePaper,
  LiteraturePaperStatus,
  LiteratureSettings,
  PaperCitationNetwork,
  PaperWorkspaceAnalysis,
  UpdateLiteratureRequest,
  UpdateLiteratureResponse,
} from "@/lib/literature/types";
import type { LibraryFilters } from "@/lib/literature/library-filters";
import type {
  LiteratureReviewExportRequest,
  LiteratureReviewRequest,
  LiteratureReviewResponse,
} from "@/lib/literature/review/types";
import { downloadBlob } from "@/lib/export/download";

export { LiteratureError };

export type LiteratureState = {
  settings: LiteratureSettings;
  papers: LiteraturePaper[];
};

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().slice(0, 220);
    throw new LiteratureError(
      preview
        ? `文献 API 响应无效。状态码：${response.status}。返回内容：${preview}`
        : `文献 API 响应无效。状态码：${response.status}。`,
      response.status,
    );
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
    throw new LiteratureError("文献更新响应无效。", 502);
  }

  const record = payload as Record<string, unknown>;

  if (!validateLiteratureSettings(record.settings)) {
    console.error("[literature] update response validation failed: settings invalid");
    throw new LiteratureError("文献更新响应无效。", 502);
  }

  if (!Array.isArray(record.papers)) {
    console.error("[literature] update response validation failed: papers not array");
    throw new LiteratureError("文献更新响应无效。", 502);
  }

  for (let index = 0; index < record.papers.length; index += 1) {
    const failure = getLiteraturePaperValidationFailure(record.papers[index], index);
    if (failure) {
      console.error(`[literature] update response validation failed: ${failure}`);
      throw new LiteratureError("文献更新响应无效。", 502);
    }
  }

  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((item): item is string => typeof item === "string")
    : undefined;

  const failedProviders = Array.isArray(record.failedProviders)
    ? record.failedProviders.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;

  return {
    settings: record.settings,
    papers: record.papers as LiteraturePaper[],
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
    ...(failedProviders && failedProviders.length > 0
      ? { failedProviders }
      : {}),
    debug: parseLiteratureSearchDebug(record.debug),
  };
}

function parseLiteratureSearchDebug(
  value: unknown,
): UpdateLiteratureResponse["debug"] {
  if (value === undefined || value === null || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.summary !== "object" || record.summary === null) {
    return undefined;
  }

  if (!Array.isArray(record.papers)) {
    return undefined;
  }

  return value as UpdateLiteratureResponse["debug"];
}

export function buildUpdateLiteratureRequest(
  settings: LiteratureSettings,
): UpdateLiteratureRequest {
  return {
    researchDirection: settings.researchDirection,
    keywords: settings.keywords.trim(),
    excludeKeywords: settings.excludeKeywords,
    discipline: settings.discipline,
    selectedSources: settings.selectedSources,
    dateRangeDays: normalizeDateRangeDays(settings.dateRangeDays),
  };
}

export async function fetchLiteratureState(): Promise<LiteratureState> {
  const response = await fetch("/api/literature");

  const payload = await parseJson<LiteratureState & { error?: string }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "加载文献追踪失败。",
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
      payload.error ?? "保存文献设置失败。",
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
      errorPayload.error ?? "更新文献失败。",
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
      payload.error ?? "加载文献库失败。",
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
      payload.error ?? "加载论文失败。",
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
      payload.error ?? "更新阅读状态失败。",
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
      payload.error ?? "加载文献夹失败。",
      response.status,
    );
  }

  return payload.folders ?? [];
}

export async function createLiteratureFolder(input: {
  name: string;
  parentId?: string | null;
  description?: string | null;
}): Promise<LiteratureFolder> {
  const response = await fetch("/api/literature/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = await parseJson<{ folder: LiteratureFolder; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "创建文献夹失败。",
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
      payload.error ?? "重命名文献夹失败。",
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
      payload.error ?? "删除文献夹失败。",
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
      payload.error ?? "更新论文文献夹失败。",
      response.status,
    );
  }

  return payload.folderIds ?? [];
}

export async function savePaperSnapshotToFolders(
  paper: LiteraturePaper,
  folderIds: string[],
): Promise<LiteraturePaper> {
  const response = await fetch("/api/literature/papers/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper, folderIds }),
  });

  const payload = await parseJson<{ paper: LiteraturePaper; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(payload.error ?? "保存文献失败。", response.status);
  }

  return payload.paper;
}

export async function uploadPaperPdfToFolders(
  paper: LiteraturePaper,
  folderIds: string[],
  file: File,
): Promise<LiteraturePaper> {
  const formData = new FormData();
  formData.set("paper", JSON.stringify(paper));
  formData.set("folderIds", JSON.stringify(folderIds));
  formData.set("file", file);

  const response = await fetch("/api/literature/papers/upload", {
    method: "POST",
    body: formData,
  });

  const payload = await parseJson<{ paper: LiteraturePaper; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(payload.error ?? "上传 PDF 失败。", response.status);
  }

  return payload.paper;
}

export async function uploadLocalPdfToLibrary(
  folderIds: string[],
  file: File,
): Promise<LiteraturePaper> {
  const formData = new FormData();
  formData.set("folderIds", JSON.stringify(folderIds));
  formData.set("file", file);

  const response = await fetch("/api/literature/library/upload", {
    method: "POST",
    body: formData,
  });

  const payload = await parseJson<{ paper: LiteraturePaper; error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(payload.error ?? "上传 PDF 失败。", response.status);
  }

  return payload.paper;
}

export async function deleteLiteraturePaper(paperId: string): Promise<void> {
  const response = await fetch(`/api/literature/papers/${paperId}`, {
    method: "DELETE",
  });

  const payload = await parseJson<{ error?: string }>(response);

  if (!response.ok) {
    throw new LiteratureError(payload.error ?? "删除文献失败。", response.status);
  }
}

export async function updateLiteraturePaperNotes(
  paperId: string,
  notes: string,
): Promise<LiteraturePaper> {
  const response = await fetch(`/api/literature/papers/${paperId}/notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });

  const payload = await parseJson<{ paper: LiteraturePaper; error?: string }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "保存笔记失败。",
      response.status,
    );
  }

  return payload.paper;
}

export async function fetchLiteraturePaperCitationNetwork(
  paperId: string,
): Promise<PaperCitationNetwork> {
  const response = await fetch(`/api/literature/papers/${paperId}/citation-network`);
  const payload = await parseJson<PaperCitationNetwork & { error?: string }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "加载引用网络失败。",
      response.status,
    );
  }

  return {
    citationCount: payload.citationCount ?? null,
    referenceCount: payload.referenceCount ?? null,
    influentialCitationCount: payload.influentialCitationCount ?? null,
    references: payload.references ?? [],
    citations: payload.citations ?? [],
    relatedPapers: payload.relatedPapers ?? [],
    rateLimited: payload.rateLimited === true,
    message: typeof payload.message === "string" ? payload.message : undefined,
  };
}

export async function generateLiteraturePaperWorkspace(
  paperId: string,
  refresh = false,
): Promise<{ paper: LiteraturePaper; workspaceAnalysis: PaperWorkspaceAnalysis }> {
  const query = refresh ? "?refresh=true" : "";
  const response = await fetch(`/api/literature/papers/${paperId}/workspace${query}`, {
    method: "POST",
  });

  const payload = await parseJson<{
    paper: LiteraturePaper;
    workspaceAnalysis: PaperWorkspaceAnalysis;
    error?: string;
  }>(response);

  if (!response.ok) {
    throw new LiteratureError(
      payload.error ?? "生成 AI 分析失败。",
      response.status,
    );
  }

  return {
    paper: payload.paper,
    workspaceAnalysis: payload.workspaceAnalysis,
  };
}

export async function generateLiteratureReview(
  request: LiteratureReviewRequest,
  signal?: AbortSignal,
): Promise<LiteratureReviewResponse> {
  const response = await fetch("/api/literature/review/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  const payload = await parseJson<LiteratureReviewResponse & { error?: string }>(
    response,
  );

  if (!response.ok) {
    throw new LiteratureError(payload.error ?? "生成文献综述失败。", response.status);
  }

  return payload;
}

export async function exportLiteratureReview(
  request: LiteratureReviewExportRequest,
): Promise<{ filename: string }> {
  const response = await fetch("/api/literature/review/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const payload = await parseJson<{
    success: boolean;
    filename?: string;
    downloadUrl?: string;
    error?: string;
  }>(response);

  if (!response.ok || !payload.success || !payload.downloadUrl || !payload.filename) {
    throw new LiteratureError(payload.error ?? "导出失败。", response.status);
  }

  const downloadResponse = await fetch(payload.downloadUrl);
  if (!downloadResponse.ok) {
    throw new LiteratureError("下载导出文件失败。", 502);
  }

  const blob = await downloadResponse.blob();
  downloadBlob(blob, payload.filename);
  return { filename: payload.filename };
}
