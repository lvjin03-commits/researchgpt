// Server-only module.

import type { SupabaseClient } from "@supabase/supabase-js";
import { listLiteratureFolderPapers } from "@/lib/literature/server/folder-papers";
import type { LiteraturePaper } from "@/lib/literature/types";

export {
  listLiteratureFolderPapers,
  loadReviewFolderPapersWithLog,
} from "@/lib/literature/server/folder-papers";

export async function loadReviewFolderPapers(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
): Promise<LiteraturePaper[]> {
  return listLiteratureFolderPapers(supabase, userId, folderId);
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
