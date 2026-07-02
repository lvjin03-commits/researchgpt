export type LiteratureSource = "arxiv";

export type LiteraturePriority = "recommended" | "skim" | "skip";

export type LiteraturePaperStatus = "new" | "saved" | "skipped" | "read";

export type LiteratureSettings = {
  researchDirection: string;
  keywords: string;
  excludeKeywords: string;
  source: LiteratureSource;
  dateRangeDays: number;
};

export type LiteraturePaper = {
  id: string;
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string | null;
  pdfUrl: string;
  absUrl: string;
  categories: string[];
  relevanceScore: number | null;
  priority: LiteraturePriority | null;
  chineseSummary: string | null;
  recommendationReason: string | null;
  status: LiteraturePaperStatus;
  fetchedAt: string;
};

export type ArxivPaperDraft = {
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string | null;
  pdfUrl: string;
  absUrl: string;
  categories: string[];
};

export type PaperAnalysisResult = {
  arxivId: string;
  relevanceScore: number;
  priority: LiteraturePriority;
  chineseSummary: string;
  recommendationReason: string;
};

export type UpdateLiteratureRequest = LiteratureSettings;

export type UpdateLiteratureResponse = {
  added: number;
  updated: number;
  papers: LiteraturePaper[];
};
