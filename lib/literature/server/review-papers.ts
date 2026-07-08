// Server-only module.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REVIEW_TIME_RANGE_YEARS,
  type REVIEW_TIME_RANGE_OPTIONS,
} from "@/lib/literature/review/constants";
import type { ReviewTimeRange } from "@/lib/literature/review/types";
import { getPaperFolderIdsMap } from "@/lib/literature/server/folder-repository";
import { listLiteratureLibraryPapers } from "@/lib/literature/server/repository";
import type { LiteraturePaper } from "@/lib/literature/types";

function resolveTimeRangeYears(
  timeRange: ReviewTimeRange,
  customYears?: number,
): number | null {
  if (timeRange === "全部文献") {
    return null;
  }

  if (timeRange === "自定义") {
    return customYears ?? null;
  }

  return REVIEW_TIME_RANGE_YEARS[
    timeRange as Exclude<
      (typeof REVIEW_TIME_RANGE_OPTIONS)[number],
      "全部文献" | "自定义"
    >
  ];
}

function paperWithinYears(paper: LiteraturePaper, years: number | null): boolean {
  if (years === null) {
    return true;
  }

  if (!paper.publishedAt) {
    return true;
  }

  const publishedTime = Date.parse(paper.publishedAt);
  if (Number.isNaN(publishedTime)) {
    return true;
  }

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return publishedTime >= cutoff.getTime();
}

export async function loadReviewFolderPapers(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
  timeRange: ReviewTimeRange,
  customTimeRangeYears?: number,
): Promise<LiteraturePaper[]> {
  const paperFolderIds = await getPaperFolderIdsMap(supabase, userId);
  const papers = await listLiteratureLibraryPapers(
    supabase,
    userId,
    {
      status: "all",
      q: "",
      source: "",
      discipline: "",
      priority: "",
      folderId,
    },
    paperFolderIds,
  );

  const years = resolveTimeRangeYears(timeRange, customTimeRangeYears);
  return papers.filter((paper) => paperWithinYears(paper, years));
}

export function formatPaperYear(paper: LiteraturePaper): string {
  if (!paper.publishedAt) {
    return "年份未知";
  }

  const year = new Date(paper.publishedAt).getFullYear();
  return Number.isFinite(year) ? String(year) : "年份未知";
}

export function buildReviewPaperContext(papers: LiteraturePaper[]) {
  return papers.map((paper) => ({
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: formatPaperYear(paper),
    abstract: paper.abstract.slice(0, 1200),
    url: paper.absUrl,
    citationCount: paper.citationCount ?? null,
  }));
}
