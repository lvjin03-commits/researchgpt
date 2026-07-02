// Server-only module.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LiteratureError } from "@/lib/literature/errors";
import type {
  ArxivPaperDraft,
  LiteraturePaper,
  LiteraturePaperStatus,
  LiteratureSettings,
  PaperAnalysisResult,
} from "@/lib/literature/types";

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
};

const DEFAULT_SETTINGS: LiteratureSettings = {
  researchDirection: "",
  keywords: "",
  excludeKeywords: "",
  source: "arxiv",
  dateRangeDays: 7,
};

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
  return {
    id: row.id,
    arxivId: row.arxiv_id,
    title: row.title,
    abstract: row.abstract,
    authors: row.authors ?? [],
    publishedAt: row.published_at,
    pdfUrl: row.pdf_url,
    absUrl: row.abs_url,
    categories: row.categories ?? [],
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
  };
}

async function readFileStore(userId: string): Promise<LiteratureStore> {
  try {
    const raw = await fs.readFile(storePath(userId), "utf8");
    const parsed = JSON.parse(raw) as LiteratureStore;
    return {
      settings: parsed.settings ?? DEFAULT_SETTINGS,
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

  return {
    id: randomUUID(),
    arxivId: draft.arxivId,
    title: draft.title,
    abstract: draft.abstract,
    authors: draft.authors,
    publishedAt: draft.publishedAt,
    pdfUrl: draft.pdfUrl,
    absUrl: draft.absUrl,
    categories: draft.categories,
    relevanceScore: analysis?.relevanceScore ?? null,
    priority: analysis?.priority ?? null,
    chineseSummary: analysis?.chineseSummary ?? null,
    recommendationReason: analysis?.recommendationReason ?? null,
    status: existingStatus ?? "new",
    fetchedAt: now,
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

  return {
    researchDirection: row.research_direction ?? "",
    keywords: row.keywords ?? "",
    excludeKeywords: row.exclude_keywords ?? "",
    source: row.source === "arxiv" ? "arxiv" : "arxiv",
    dateRangeDays: row.date_range_days ?? 7,
  };
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
      source: settings.source,
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
      return store.papers.sort((left, right) => {
        const leftScore = left.relevanceScore ?? -1;
        const rightScore = right.relevanceScore ?? -1;
        return rightScore - leftScore;
      });
    }

    throw new LiteratureError(error.message, 500);
  }

  return ((data ?? []) as DbPaperRow[]).map(mapPaperRow);
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
      const merged: LiteraturePaper = {
        ...current,
        title: draft.title,
        abstract: draft.abstract,
        authors: draft.authors,
        publishedAt: draft.publishedAt,
        pdfUrl: draft.pdfUrl,
        absUrl: draft.absUrl,
        categories: draft.categories,
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
    const record = nextPapers.find((paper) => paper.arxivId === draft.arxivId)!;

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
      categories: record.categories,
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
