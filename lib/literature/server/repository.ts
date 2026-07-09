// Server-only module.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LiteratureError } from "@/lib/literature/errors";
import { normalizeLiteratureSettings } from "@/lib/literature/normalize-settings";
import {
  applyDraftProviderMetadata,
  embedPaperProviderMetadata,
  extractPaperProviderMetadata,
  resolvePaperProviderMetadata,
} from "@/lib/literature/paper-providers";
import {
  DEFAULT_LITERATURE_DISCIPLINE,
  isValidDisciplineId,
} from "@/lib/literature/source-taxonomy";
import type { LiteratureDisciplineId } from "@/lib/literature/source-taxonomy";
import { LITERATURE_DATE_RANGE_DAYS } from "@/lib/literature/constants";
import type {
  ArxivPaperDraft,
  LiteraturePaper,
  LiteraturePaperStatus,
  LiteratureSettings,
  PaperAnalysisResult,
  PaperWorkspaceAnalysis,
} from "@/lib/literature/types";
import { isValidWorkspaceAnalysis } from "@/lib/literature/paper-workspace-display";
import type { LibraryFilters } from "@/lib/literature/library-filters";
import { filterLibraryPapers } from "@/lib/literature/library-filters";

const LITERATURE_DIR = path.join(os.tmpdir(), "researchgpt-literature");

type LiteratureStore = {
  settings: LiteratureSettings;
  papers: LiteraturePaper[];
};

type DbSettingsRow = {
  research_direction: string;
  keywords: string;
  exclude_keywords: string;
  source: string;
  discipline: string | null;
  selected_sources: string[] | null;
  date_range_days: number;
};

type DbPaperRow = {
  id: string;
  arxiv_id: string;
  title: string;
  abstract: string;
  authors: string[] | null;
  published_at: string | null;
  pdf_url: string;
  abs_url: string;
  categories: string[] | null;
  relevance_score: number | null;
  priority: string | null;
  chinese_summary: string | null;
  recommendation_reason: string | null;
  status: string;
  fetched_at: string;
  personal_notes?: string | null;
  workspace_analysis?: unknown | null;
  pdf_storage_path?: string | null;
  pdf_file_name?: string | null;
  pdf_file_size?: number | null;
  pdf_download_status?: string | null;
  pdf_download_error?: string | null;
  full_text?: string | null;
  full_text_extracted_at?: string | null;
};

const DEFAULT_SETTINGS: LiteratureSettings = normalizeLiteratureSettings({
  discipline: DEFAULT_LITERATURE_DISCIPLINE,
  selectedSources: ["arxiv"],
  dateRangeDays: LITERATURE_DATE_RANGE_DAYS,
});

function parseSelectedSourcesColumn(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      return [];
    }
  }

  return [];
}

function mapSettingsRow(row: DbSettingsRow): LiteratureSettings {
  const discipline = isValidDisciplineId(row.discipline ?? "")
    ? (row.discipline as LiteratureDisciplineId)
    : DEFAULT_LITERATURE_DISCIPLINE;

  return normalizeLiteratureSettings({
    researchDirection: row.research_direction ?? "",
    keywords: row.keywords ?? "",
    excludeKeywords: row.exclude_keywords ?? "",
    discipline,
    selectedSources: parseSelectedSourcesColumn(row.selected_sources),
    source: row.source,
    dateRangeDays: row.date_range_days ?? LITERATURE_DATE_RANGE_DAYS,
  });
}

function storePath(userId: string): string {
  return path.join(LITERATURE_DIR, `${userId}.json`);
}

function isMissingTableError(error: { message?: string; code?: string }): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("literature_settings") ||
    message.includes("literature_papers") ||
    message.includes("does not exist")
  );
}

function mapPaperRow(row: DbPaperRow): LiteraturePaper {
  const workspaceAnalysis =
    row.workspace_analysis && isValidWorkspaceAnalysis(row.workspace_analysis)
      ? (row.workspace_analysis as PaperWorkspaceAnalysis)
      : null;

  const metadata = extractPaperProviderMetadata(row.categories ?? []);

  return resolvePaperProviderMetadata({
    id: row.id,
    arxivId: row.arxiv_id,
    title: row.title,
    abstract: row.abstract,
    authors: row.authors ?? [],
    publishedAt: row.published_at,
    pdfUrl: row.pdf_url,
    absUrl: row.abs_url,
    categories: metadata.displayCategories,
    relevanceScore: row.relevance_score,
    priority:
      row.priority === "recommended" ||
      row.priority === "skim" ||
      row.priority === "skip"
        ? row.priority
        : null,
    chineseSummary: row.chinese_summary,
    recommendationReason: row.recommendation_reason,
    status:
      row.status === "saved" ||
      row.status === "skipped" ||
      row.status === "read" ||
      row.status === "new"
        ? row.status
        : "new",
    fetchedAt: row.fetched_at,
    pdfStoragePath: row.pdf_storage_path ?? null,
    pdfFileName: row.pdf_file_name ?? null,
    pdfFileSize: row.pdf_file_size ?? null,
    pdfDownloadStatus:
      row.pdf_download_status === "stored" ||
      row.pdf_download_status === "failed" ||
      row.pdf_download_status === "unavailable" ||
      row.pdf_download_status === "not_attempted"
        ? row.pdf_download_status
        : "not_attempted",
    pdfDownloadError: row.pdf_download_error ?? null,
    fullText: row.full_text ?? null,
    fullTextExtractedAt: row.full_text_extracted_at ?? null,
    personalNotes: row.personal_notes ?? "",
    workspaceAnalysis,
    providers: metadata.providers,
    sourceUrls: metadata.sourceUrls,
    rankingScore: metadata.rankingScore,
  });
}

async function readFileStore(userId: string): Promise<LiteratureStore> {
  try {
    const raw = await fs.readFile(storePath(userId), "utf8");
    const parsed = JSON.parse(raw) as LiteratureStore;
    return {
      settings: normalizeLiteratureSettings(parsed.settings ?? {}),
      papers: Array.isArray(parsed.papers) ? parsed.papers : [],
    };
  } catch {
    return { settings: DEFAULT_SETTINGS, papers: [] };
  }
}

async function writeFileStore(
  userId: string,
  store: LiteratureStore,
): Promise<void> {
  await fs.mkdir(LITERATURE_DIR, { recursive: true });
  await fs.writeFile(storePath(userId), JSON.stringify(store, null, 2), "utf8");
}

function buildPaperRecord(
  userId: string,
  draft: ArxivPaperDraft,
  analysis: PaperAnalysisResult | undefined,
  existingStatus: LiteraturePaperStatus | null,
): LiteraturePaper {
  const now = new Date().toISOString();
  const preparedDraft = applyDraftProviderMetadata(draft);
  const metadata = extractPaperProviderMetadata(preparedDraft.categories);

  return {
    id: randomUUID(),
    arxivId: preparedDraft.arxivId,
    title: preparedDraft.title,
    abstract: preparedDraft.abstract,
    authors: preparedDraft.authors,
    publishedAt: preparedDraft.publishedAt,
    pdfUrl: preparedDraft.pdfUrl,
    absUrl: preparedDraft.absUrl,
    categories: metadata.displayCategories,
    relevanceScore: analysis?.relevanceScore ?? null,
    priority: analysis?.priority ?? null,
    chineseSummary: analysis?.chineseSummary ?? null,
    recommendationReason: analysis?.recommendationReason ?? null,
    status: existingStatus ?? "new",
    fetchedAt: now,
    citationCount: preparedDraft.citationCount ?? null,
    rankingScore: preparedDraft.rankingScore ?? metadata.rankingScore,
    providers: preparedDraft.providers ?? metadata.providers,
    sourceUrls: preparedDraft.sourceUrls ?? metadata.sourceUrls,
  };
}

export async function getLiteratureSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<LiteratureSettings> {
  const { data, error } = await supabase
    .from("literature_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const store = await readFileStore(userId);
      return store.settings;
    }

    throw new LiteratureError(error.message, 500);
  }

  if (!data) {
    return DEFAULT_SETTINGS;
  }

  const row = data as DbSettingsRow & { user_id: string };

  return mapSettingsRow(row);
}

export async function saveLiteratureSettings(
  supabase: SupabaseClient,
  userId: string,
  settings: LiteratureSettings,
): Promise<void> {
  const { error } = await supabase.from("literature_settings").upsert(
    {
      user_id: userId,
      research_direction: settings.researchDirection,
      keywords: settings.keywords,
      exclude_keywords: settings.excludeKeywords,
      source: settings.selectedSources.includes("arxiv") ? "arxiv" : "arxiv",
      discipline: settings.discipline,
      selected_sources: settings.selectedSources,
      date_range_days: settings.dateRangeDays,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    if (isMissingTableError(error)) {
      const store = await readFileStore(userId);
      store.settings = settings;
      await writeFileStore(userId, store);
      return;
    }

    throw new LiteratureError(error.message, 500);
  }
}

export async function listLiteraturePapers(
  supabase: SupabaseClient,
  userId: string,
): Promise<LiteraturePaper[]> {
  const { data, error } = await supabase
    .from("literature_papers")
    .select("*")
    .eq("user_id", userId)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .order("fetched_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      const store = await readFileStore(userId);
      return store.papers
        .map(resolvePaperProviderMetadata)
        .sort((left, right) => {
        const leftScore = left.relevanceScore ?? -1;
        const rightScore = right.relevanceScore ?? -1;
        return rightScore - leftScore;
      });
    }

    throw new LiteratureError(error.message, 500);
  }

  return ((data ?? []) as DbPaperRow[]).map(mapPaperRow);
}

export async function listLiteratureLibraryPapers(
  supabase: SupabaseClient,
  userId: string,
  filters: LibraryFilters,
  paperFolderIds?: Map<string, string[]>,
): Promise<LiteraturePaper[]> {
  const papers = await listLiteraturePapers(supabase, userId);
  const filtered = filterLibraryPapers(papers, filters, paperFolderIds);

  if (!paperFolderIds) {
    return filtered;
  }

  return filtered.map((paper) => ({
    ...paper,
    folderIds: paperFolderIds.get(paper.id) ?? [],
  }));
}

export function stripLiteraturePaperFullTextForResponse(
  paper: LiteraturePaper,
): LiteraturePaper {
  return {
    ...paper,
    fullText: paper.fullText ? null : paper.fullText,
  };
}

export async function upsertAnalyzedPapers(
  supabase: SupabaseClient,
  userId: string,
  drafts: ArxivPaperDraft[],
  analysisById: Map<string, PaperAnalysisResult>,
): Promise<{ added: number; updated: number; papers: LiteraturePaper[] }> {
  const existing = await listLiteraturePapers(supabase, userId);
  const existingByArxivId = new Map(
    existing.map((paper) => [paper.arxivId, paper]),
  );

  let added = 0;
  let updated = 0;
  const nextPapers: LiteraturePaper[] = [...existing];

  for (const draft of drafts) {
    const analysis = analysisById.get(draft.arxivId);
    const current = existingByArxivId.get(draft.arxivId);

    if (current) {
      const preparedDraft = applyDraftProviderMetadata(draft);
      const metadata = extractPaperProviderMetadata(preparedDraft.categories);
      const merged: LiteraturePaper = {
        ...current,
        title: preparedDraft.title,
        abstract: preparedDraft.abstract,
        authors: preparedDraft.authors,
        publishedAt: preparedDraft.publishedAt,
        pdfUrl: preparedDraft.pdfUrl,
        absUrl: preparedDraft.absUrl,
        categories: metadata.displayCategories,
        providers: preparedDraft.providers ?? metadata.providers,
        sourceUrls: preparedDraft.sourceUrls ?? metadata.sourceUrls,
        citationCount: preparedDraft.citationCount ?? current.citationCount ?? null,
        rankingScore: preparedDraft.rankingScore ?? metadata.rankingScore ?? current.rankingScore,
        relevanceScore: analysis?.relevanceScore ?? current.relevanceScore,
        priority: analysis?.priority ?? current.priority,
        chineseSummary: analysis?.chineseSummary ?? current.chineseSummary,
        recommendationReason:
          analysis?.recommendationReason ?? current.recommendationReason,
        fetchedAt: new Date().toISOString(),
      };

      const index = nextPapers.findIndex((paper) => paper.id === current.id);
      if (index >= 0) {
        nextPapers[index] = merged;
      }

      updated += 1;
      continue;
    }

    const created = buildPaperRecord(
      userId,
      draft,
      analysis,
      null,
    );

    nextPapers.push(created);
    added += 1;
  }

  const upsertRows = drafts.map((draft) => {
    const preparedDraft = applyDraftProviderMetadata(draft);
    const record = nextPapers.find((paper) => paper.arxivId === preparedDraft.arxivId)!;
    const storedCategories = embedPaperProviderMetadata(
      record.categories,
      {
        providers: record.providers,
        sourceUrls: record.sourceUrls,
        rankingScore: record.rankingScore,
      },
    );

    return {
      id: record.id,
      user_id: userId,
      arxiv_id: record.arxivId,
      title: record.title,
      abstract: record.abstract,
      authors: record.authors,
      published_at: record.publishedAt,
      pdf_url: record.pdfUrl,
      abs_url: record.absUrl,
      categories: storedCategories,
      relevance_score: record.relevanceScore,
      priority: record.priority,
      chinese_summary: record.chineseSummary,
      recommendation_reason: record.recommendationReason,
      status: record.status,
      fetched_at: record.fetchedAt,
    };
  });

  const { error } = await supabase.from("literature_papers").upsert(upsertRows, {
    onConflict: "user_id,arxiv_id",
  });

  if (error) {
    if (isMissingTableError(error)) {
      const store = await readFileStore(userId);
      store.papers = nextPapers;
      await writeFileStore(userId, store);
      return {
        added,
        updated,
        papers: nextPapers.sort((left, right) => {
          const leftScore = left.relevanceScore ?? -1;
          const rightScore = right.relevanceScore ?? -1;
          return rightScore - leftScore;
        }),
      };
    }

    throw new LiteratureError(error.message, 500);
  }

  return {
    added,
    updated,
    papers: await listLiteraturePapers(supabase, userId),
  };
}

export async function updateLiteraturePaperStatus(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
  status: LiteraturePaperStatus,
): Promise<LiteraturePaper> {
  const { data, error } = await supabase
    .from("literature_papers")
    .update({ status })
    .eq("user_id", userId)
    .eq("id", paperId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const store = await readFileStore(userId);
      const index = store.papers.findIndex((paper) => paper.id === paperId);

      if (index === -1) {
        throw new LiteratureError("Paper not found.", 404);
      }

      store.papers[index] = { ...store.papers[index], status };
      await writeFileStore(userId, store);
      return store.papers[index];
    }

    throw new LiteratureError(error.message, 500);
  }

  if (!data) {
    throw new LiteratureError("Paper not found.", 404);
  }

  return mapPaperRow(data as DbPaperRow);
}

export async function updateLiteraturePaperStatusByExternalKey(
  supabase: SupabaseClient,
  userId: string,
  externalKey: string,
  status: LiteraturePaperStatus,
): Promise<LiteraturePaper> {
  const paper = (await listLiteraturePapers(supabase, userId)).find(
    (item) => item.arxivId === externalKey,
  );

  if (!paper) {
    throw new LiteratureError("Paper not found.", 404);
  }

  return updateLiteraturePaperStatus(supabase, userId, paper.id, status);
}

function isMissingPdfArchiveColumnError(error: {
  message?: string;
  code?: string;
}): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    isMissingTableError(error) ||
    message.includes("pdf_storage_path") ||
    message.includes("pdf_file_name") ||
    message.includes("pdf_file_size") ||
    message.includes("pdf_download_status") ||
    message.includes("pdf_download_error") ||
    message.includes("full_text") ||
    message.includes("full_text_extracted_at")
  );
}

export async function updateLiteraturePaperPdfArchive(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
  patch: {
    pdfStoragePath?: string | null;
    pdfFileName?: string | null;
    pdfFileSize?: number | null;
    pdfDownloadStatus: LiteraturePaper["pdfDownloadStatus"];
    pdfDownloadError?: string | null;
    fullText?: string | null;
    fullTextExtractedAt?: string | null;
  },
): Promise<LiteraturePaper> {
  const { data, error } = await supabase
    .from("literature_papers")
    .update({
      pdf_storage_path: patch.pdfStoragePath ?? null,
      pdf_file_name: patch.pdfFileName ?? null,
      pdf_file_size: patch.pdfFileSize ?? null,
      pdf_download_status: patch.pdfDownloadStatus ?? "not_attempted",
      pdf_download_error: patch.pdfDownloadError ?? null,
      full_text: patch.fullText ?? null,
      full_text_extracted_at: patch.fullTextExtractedAt ?? null,
    })
    .eq("user_id", userId)
    .eq("id", paperId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingPdfArchiveColumnError(error)) {
      return updatePaperInFileStore(userId, paperId, {
        pdfStoragePath: patch.pdfStoragePath ?? null,
        pdfFileName: patch.pdfFileName ?? null,
        pdfFileSize: patch.pdfFileSize ?? null,
        pdfDownloadStatus: patch.pdfDownloadStatus ?? "not_attempted",
        pdfDownloadError: patch.pdfDownloadError ?? null,
        fullText: patch.fullText ?? null,
        fullTextExtractedAt: patch.fullTextExtractedAt ?? null,
      });
    }

    throw new LiteratureError(error.message, 500);
  }

  if (!data) {
    throw new LiteratureError("Paper not found.", 404);
  }

  return mapPaperRow(data as DbPaperRow);
}

export async function getLiteraturePaperById(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
): Promise<LiteraturePaper> {
  const { data, error } = await supabase
    .from("literature_papers")
    .select("*")
    .eq("user_id", userId)
    .eq("id", paperId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const store = await readFileStore(userId);
      const paper = store.papers.find((item) => item.id === paperId);

      if (!paper) {
        throw new LiteratureError("Paper not found.", 404);
      }

      return paper;
    }

    throw new LiteratureError(error.message, 500);
  }

  if (!data) {
    throw new LiteratureError("Paper not found.", 404);
  }

  return mapPaperRow(data as DbPaperRow);
}

function isMissingWorkspaceColumnError(error: { message?: string; code?: string }): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    isMissingTableError(error) ||
    message.includes("personal_notes") ||
    message.includes("workspace_analysis")
  );
}

async function updatePaperInFileStore(
  userId: string,
  paperId: string,
  patch: Partial<LiteraturePaper>,
): Promise<LiteraturePaper> {
  const store = await readFileStore(userId);
  const index = store.papers.findIndex((paper) => paper.id === paperId);

  if (index === -1) {
    throw new LiteratureError("Paper not found.", 404);
  }

  store.papers[index] = { ...store.papers[index], ...patch };
  await writeFileStore(userId, store);
  return store.papers[index];
}

export async function updateLiteraturePaperNotes(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
  notes: string,
): Promise<LiteraturePaper> {
  const { data, error } = await supabase
    .from("literature_papers")
    .update({ personal_notes: notes })
    .eq("user_id", userId)
    .eq("id", paperId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingWorkspaceColumnError(error)) {
      return updatePaperInFileStore(userId, paperId, { personalNotes: notes });
    }

    throw new LiteratureError(error.message, 500);
  }

  if (!data) {
    throw new LiteratureError("Paper not found.", 404);
  }

  return mapPaperRow(data as DbPaperRow);
}

export async function saveLiteraturePaperWorkspaceAnalysis(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
  workspaceAnalysis: PaperWorkspaceAnalysis,
): Promise<LiteraturePaper> {
  const { data, error } = await supabase
    .from("literature_papers")
    .update({ workspace_analysis: workspaceAnalysis })
    .eq("user_id", userId)
    .eq("id", paperId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingWorkspaceColumnError(error)) {
      return updatePaperInFileStore(userId, paperId, { workspaceAnalysis });
    }

    throw new LiteratureError(error.message, 500);
  }

  if (!data) {
    throw new LiteratureError("Paper not found.", 404);
  }

  return mapPaperRow(data as DbPaperRow);
}
