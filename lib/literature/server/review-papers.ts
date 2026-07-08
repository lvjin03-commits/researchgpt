// Server-only module.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPaperFolderIdsMap } from "@/lib/literature/server/folder-repository";
import { listLiteratureLibraryPapers } from "@/lib/literature/server/repository";
import type { LiteraturePaper } from "@/lib/literature/types";

export async function loadReviewFolderPapers(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
): Promise<LiteraturePaper[]> {
  const paperFolderIds = await getPaperFolderIdsMap(supabase, userId);

  return listLiteratureLibraryPapers(
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
