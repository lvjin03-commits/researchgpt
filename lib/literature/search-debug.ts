import type { LiteratureProviderId } from "@/lib/literature/providers/base";

export type LiteratureDedupeMatchReason =
  | "new"
  | "doi"
  | "pmid"
  | "arxiv"
  | "openreview"
  | "title"
  | "fuzzy_title";

export type UnifiedPaperDebugRecord = {
  matchedBy: LiteratureDedupeMatchReason;
  mergeSourceCount: number;
};

export type LiteratureSearchDebugSummary = {
  openalex: number;
  arxiv: number;
  pubmed: number;
  crossref: number;
  dblp: number;
  openreview: number;
  totalFetched: number;
  duplicatesRemoved: number;
  finalPapers: number;
};

export type LiteraturePaperSearchDebug = {
  arxivId: string;
  title: string;
  providers: LiteratureProviderId[];
  matchedBy: LiteratureDedupeMatchReason;
  mergeSourceCount: number;
  rankingScore?: number;
};

export type LiteratureSearchDebug = {
  summary: LiteratureSearchDebugSummary;
  papers: LiteraturePaperSearchDebug[];
  failedProviders?: LiteratureProviderId[];
};

export const LITERATURE_DEDUPE_MATCH_LABELS: Record<
  LiteratureDedupeMatchReason,
  string
> = {
  new: "New",
  doi: "DOI",
  pmid: "PMID",
  arxiv: "arXiv ID",
  openreview: "OpenReview ID",
  title: "Title",
  fuzzy_title: "Fuzzy Title",
};

export function formatLiteratureDedupeMatchLabel(
  matchedBy: LiteratureDedupeMatchReason,
  mergeSourceCount: number,
): string {
  if (mergeSourceCount <= 1) {
    return LITERATURE_DEDUPE_MATCH_LABELS.new;
  }

  return LITERATURE_DEDUPE_MATCH_LABELS[matchedBy];
}
