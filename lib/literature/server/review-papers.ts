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
  includeFullText?: boolean;
  includeWorkspaceAnalysis?: boolean;
};

export function buildReviewPaperContext(
  papers: LiteraturePaper[],
  options: ReviewPaperContextOptions = {},
) {
  const maxFullTextChars = options.maxFullTextChars ?? 5000;
  const maxFigureEvidence = options.maxFigureEvidence ?? 5;
  const maxFigureCaptionChars = options.maxFigureCaptionChars ?? 600;
  const includeFullText = options.includeFullText ?? true;
  const includeWorkspaceAnalysis = options.includeWorkspaceAnalysis ?? true;

  return papers.map((paper) => {
    const figureEvidence = includeFullText
      ? paper.figureEvidence && paper.figureEvidence.length > 0
        ? paper.figureEvidence
        : extractFigureEvidenceFromText(paper.fullText, paper)
      : [];

    return {
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: formatPaperYear(paper),
      abstract: paper.abstract.slice(0, 1200),
      fullTextExcerpt:
        includeFullText && paper.fullText
          ? paper.fullText.slice(0, maxFullTextChars)
          : null,
      evidenceLevel:
        includeFullText && paper.fullText ? "full_text" : "abstract_only",
      workspaceAnalysis:
        includeWorkspaceAnalysis && paper.workspaceAnalysis
          ? paper.workspaceAnalysis
          : null,
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
