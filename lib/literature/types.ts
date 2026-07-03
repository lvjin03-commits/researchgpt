export type LiteraturePriority = "recommended" | "skim" | "skip";

export type LiteraturePaperStatus = "new" | "saved" | "skipped" | "read";

export type PaperWorkspaceDifficulty = "Beginner" | "Intermediate" | "Advanced";

export type PaperReadingGuide = {
  estimatedReadingMinutes: number;
  suggestedReadingOrder: string[];
  difficulty: PaperWorkspaceDifficulty;
};

export type PaperResearchValue = {
  novelty: number;
  technicalDepth: number;
  industrialPotential: number;
  readingPriority: number;
};

export type PaperWorkspaceAnalysis = {
  oneSentenceSummary: string;
  researchProblem: string;
  coreMethod: string;
  mainContributions: string;
  experimentalResults: string;
  limitations: string;
  whyItMatters: string;
  readingGuide: PaperReadingGuide;
  researchValue: PaperResearchValue;
  generatedAt: string;
};

export type LiteratureDisciplineId =
  import("@/lib/literature/source-taxonomy").LiteratureDisciplineId;

export type LiteratureSettings = {
  researchDirection: string;
  keywords: string;
  excludeKeywords: string;
  discipline: LiteratureDisciplineId;
  selectedSources: string[];
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
  folderIds?: string[];
  personalNotes?: string;
  workspaceAnalysis?: PaperWorkspaceAnalysis | null;
  /** Populated when citation metadata is available (e.g. Semantic Scholar). */
  citationCount?: number | null;
  /** Populated when journal metadata is available. */
  journalImpactFactor?: number | null;
  /** Literature providers that contributed this record. */
  providers?: import("@/lib/literature/providers/base").LiteratureProviderId[];
  /** Provider-specific landing page URLs. */
  sourceUrls?: Partial<
    Record<
      import("@/lib/literature/providers/base").LiteratureProviderId,
      string
    >
  >;
};

export type LiteratureFolder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type LiteratureLibraryResponse = {
  papers: LiteraturePaper[];
  folders: LiteratureFolder[];
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
  providers?: import("@/lib/literature/providers/base").LiteratureProviderId[];
  sourceUrls?: Partial<
    Record<
      import("@/lib/literature/providers/base").LiteratureProviderId,
      string
    >
  >;
  citationCount?: number | null;
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
  settings: LiteratureSettings;
  papers: LiteraturePaper[];
  debug?: import("@/lib/literature/search-debug").LiteratureSearchDebug;
};

export type PaperCitationNetworkItem = {
  paperId: string | null;
  title: string;
  authors: string[];
  year: number | null;
  citationCount: number | null;
  url: string | null;
  doi: string | null;
};

export type PaperCitationNetwork = {
  citationCount: number | null;
  referenceCount: number | null;
  influentialCitationCount: number | null;
  references: PaperCitationNetworkItem[];
  citations: PaperCitationNetworkItem[];
  relatedPapers: PaperCitationNetworkItem[];
  rateLimited?: boolean;
  message?: string;
};
