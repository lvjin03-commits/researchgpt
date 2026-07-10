// Server-only module.

import type { SupabaseClient } from "@supabase/supabase-js";
import { listLiteratureFolderPapers } from "@/lib/literature/server/folder-papers";
import { extractFigureEvidenceFromText } from "@/lib/literature/server/figure-evidence";
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

type ReviewPaperContextOptions = {
  maxFullTextChars?: number;
  maxFigureEvidence?: number;
  maxFigureCaptionChars?: number;
};

export function buildReviewPaperContext(
  papers: LiteraturePaper[],
  options: ReviewPaperContextOptions = {},
) {
  const maxFullTextChars = options.maxFullTextChars ?? 5000;
  const maxFigureEvidence = options.maxFigureEvidence ?? 5;
  const maxFigureCaptionChars = options.maxFigureCaptionChars ?? 600;

  return papers.map((paper) => {
    const figureEvidence =
      paper.figureEvidence && paper.figureEvidence.length > 0
        ? paper.figureEvidence
        : extractFigureEvidenceFromText(paper.fullText, paper);

    return {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: formatPaperYear(paper),
      abstract: paper.abstract.slice(0, 1200),
      fullTextExcerpt: paper.fullText?.slice(0, maxFullTextChars) ?? null,
      evidenceLevel: paper.fullText ? "full_text" : "abstract_only",
      url: paper.absUrl,
      pdfStored: paper.pdfDownloadStatus === "stored",
      citationCount: paper.citationCount ?? null,
      figureEvidence: figureEvidence.slice(0, maxFigureEvidence).map((item) => ({
        kind: item.kind,
        label: item.label,
        caption: item.caption.slice(0, maxFigureCaptionChars),
        sourceTitle: item.sourceTitle || paper.title,
        page: item.page,
        topics: item.topics.slice(0, 8),
      })),
    };
  });
}
