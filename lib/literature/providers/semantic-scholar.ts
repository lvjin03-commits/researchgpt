// Server-only module.

import { LiteratureError } from "@/lib/literature/errors";
import { getPaperDoi } from "@/lib/literature/paper-display";
import {
  buildExternalKey,
  normalizeArxivId,
  normalizeDoi,
  normalizePubmedId,
  type LiteratureProvider,
  type ProviderSearchOptions,
  type UnifiedPaper,
} from "@/lib/literature/providers/base";
import type {
  LiteraturePaper,
  PaperCitationNetwork,
  PaperCitationNetworkItem,
} from "@/lib/literature/types";

const GRAPH_BASE_URL = "https://api.semanticscholar.org/graph/v1";
const RECOMMENDATIONS_BASE_URL = "https://api.semanticscholar.org/recommendations/v1";
const NETWORK_LIST_LIMIT = 10;
const SEARCH_RESULT_LIMIT = 100;

const PAPER_FIELDS = [
  "paperId",
  "title",
  "citationCount",
  "referenceCount",
  "influentialCitationCount",
  "fieldsOfStudy",
  "externalIds",
  "url",
].join(",");

const LIST_ITEM_FIELDS = [
  "paperId",
  "title",
  "authors",
  "year",
  "citationCount",
  "externalIds",
  "url",
].join(",");

const SEARCH_PAPER_FIELDS = [
  "paperId",
  "title",
  "abstract",
  "authors",
  "year",
  "publicationDate",
  "citationCount",
  "externalIds",
  "url",
  "openAccessPdf",
  "fieldsOfStudy",
  "venue",
  "publicationTypes",
  "journal",
].join(",");

export const SEMANTIC_SCHOLAR_RATE_LIMIT_MESSAGE =
  "Semantic Scholar 请求过于频繁，请稍后再试。";

export class SemanticScholarRateLimitError extends Error {
  readonly statusCode = 429;

  constructor(message = SEMANTIC_SCHOLAR_RATE_LIMIT_MESSAGE) {
    super(message);
    this.name = "SemanticScholarRateLimitError";
  }
}

type SemanticScholarAuthor = {
  name?: string | null;
};

type SemanticScholarPaper = {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  year?: number;
  publicationDate?: string | null;
  citationCount?: number;
  referenceCount?: number;
  influentialCitationCount?: number;
  fieldsOfStudy?: string[];
  externalIds?: Record<string, string>;
  url?: string;
  authors?: SemanticScholarAuthor[];
  openAccessPdf?: {
    url?: string | null;
    status?: string | null;
  } | null;
  venue?: string | null;
  publicationTypes?: string[] | null;
  journal?: {
    name?: string | null;
    volume?: string | null;
    pages?: string | null;
  } | null;
};

type SemanticScholarSearchResponse = {
  total?: number;
  data?: SemanticScholarPaper[];
};

type SemanticScholarReferenceEntry = {
  citedPaper?: SemanticScholarPaper;
};

type SemanticScholarCitationEntry = {
  citingPaper?: SemanticScholarPaper;
};

function getSemanticScholarApiKey(): string | null {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY?.trim();
  return key || null;
}

function buildRequestHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  const apiKey = getSemanticScholarApiKey();
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

function buildLookupIds(paper: LiteraturePaper): string[] {
  const ids: string[] = [];
  const doi = getPaperDoi(paper);

  if (doi) {
    ids.push(`DOI:${doi}`);
  }

  if (paper.arxivId.startsWith("pubmed:")) {
    ids.push(`PMID:${paper.arxivId.slice("pubmed:".length)}`);
  } else if (paper.arxivId.trim()) {
    ids.push(`ArXiv:${paper.arxivId.trim()}`);
  }

  return ids;
}

function formatAuthors(authors: SemanticScholarAuthor[] | undefined): string[] {
  return (authors ?? [])
    .map((author) => author.name?.trim())
    .filter((name): name is string => Boolean(name));
}

function getDoiFromExternalIds(
  externalIds: Record<string, string> | undefined,
): string | null {
  const doi = externalIds?.DOI?.trim();
  return doi || null;
}

function mapNetworkItem(paper: SemanticScholarPaper | undefined): PaperCitationNetworkItem | null {
  if (!paper?.title?.trim()) {
    return null;
  }

  return {
    paperId: paper.paperId ?? null,
    title: paper.title.trim(),
    authors: formatAuthors(paper.authors),
    year: typeof paper.year === "number" ? paper.year : null,
    citationCount:
      typeof paper.citationCount === "number" ? paper.citationCount : null,
    url: paper.url ?? null,
    doi: getDoiFromExternalIds(paper.externalIds),
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new LiteratureError("Invalid Semantic Scholar API response.", 502);
  }
}

async function fetchSemanticScholar<T>(url: string): Promise<T | null> {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: buildRequestHeaders(),
      next: { revalidate: 300 },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new LiteratureError(
      `Semantic Scholar request failed: ${reason}`,
      502,
    );
  }

  if (response.status === 404) {
    return null;
  }

  if (response.status === 429) {
    throw new SemanticScholarRateLimitError();
  }

  if (!response.ok) {
    const payload = await parseJsonResponse<{ message?: string; error?: string }>(
      response,
    ).catch(() => ({ message: undefined, error: undefined }));

    throw new LiteratureError(
      payload.message ?? payload.error ?? "Semantic Scholar API request failed.",
      502,
    );
  }

  return parseJsonResponse<T>(response);
}

function buildSearchQuery(options: ProviderSearchOptions): string {
  return options.keywords
    .split(/[,\uFF0C;\uFF1B\n]+/u)
    .map((term) => term.trim())
    .filter(Boolean)
    .join(" ");
}

function buildSearchYearFilter(dateRangeDays: number | undefined): string | null {
  if (!dateRangeDays || dateRangeDays <= 0) {
    return null;
  }

  const end = new Date();
  const start = new Date();
  start.setUTCDate(end.getUTCDate() - dateRangeDays);
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  return startYear === endYear ? String(endYear) : `${startYear}-${endYear}`;
}

function isWithinDateRange(
  paper: SemanticScholarPaper,
  dateRangeDays: number | undefined,
): boolean {
  if (!dateRangeDays || dateRangeDays <= 0) {
    return true;
  }

  const publishedAt = paper.publicationDate?.trim();
  if (!publishedAt) {
    return true;
  }

  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) {
    return true;
  }

  const earliest = Date.now() - dateRangeDays * 24 * 60 * 60 * 1000;
  return timestamp >= earliest && timestamp <= Date.now();
}

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))] as string[];
}

function normalizeSemanticScholarPaper(
  raw: SemanticScholarPaper,
): UnifiedPaper | null {
  const paperId = raw.paperId?.trim();
  const title = raw.title?.trim();
  if (!paperId || !title) {
    return null;
  }

  const externalIds = raw.externalIds ?? {};
  const doi = normalizeDoi(externalIds.DOI);
  const arxivId = normalizeArxivId(externalIds.ArXiv);
  const pubmedId = normalizePubmedId(externalIds.PubMed);
  const absUrl =
    raw.url?.trim() || `https://www.semanticscholar.org/paper/${paperId}`;
  const pdfUrl = raw.openAccessPdf?.url?.trim() || absUrl;
  const categories = uniqueNonEmpty([
    raw.journal?.name,
    raw.venue,
    ...(raw.publicationTypes ?? []),
    ...(raw.fieldsOfStudy ?? []),
  ]);

  return {
    provider: "semantic_scholar",
    providerPaperId: paperId,
    externalKey: buildExternalKey("semantic_scholar", paperId),
    title,
    abstract: raw.abstract?.trim() ?? "",
    authors: formatAuthors(raw.authors),
    publishedAt:
      raw.publicationDate?.trim() ||
      (typeof raw.year === "number" ? `${raw.year}-01-01` : null),
    pdfUrl,
    absUrl,
    categories,
    doi,
    arxivId,
    pubmedId,
    openAlexId: null,
    openReviewId: null,
    citationCount:
      typeof raw.citationCount === "number" ? raw.citationCount : null,
    providers: ["semantic_scholar"],
    sourceUrls: { semantic_scholar: absUrl },
  };
}

async function searchSemanticScholarPapers(
  options: ProviderSearchOptions,
): Promise<SemanticScholarPaper[]> {
  const query = buildSearchQuery(options);
  if (!query) {
    throw new LiteratureError("Keywords are required.", 400);
  }

  const url = new URL(`${GRAPH_BASE_URL}/paper/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("fields", SEARCH_PAPER_FIELDS);
  url.searchParams.set(
    "limit",
    String(Math.min(options.maxResults ?? 50, SEARCH_RESULT_LIMIT)),
  );

  const yearFilter = buildSearchYearFilter(options.dateRangeDays);
  if (yearFilter) {
    url.searchParams.set("year", yearFilter);
  }

  const payload = await fetchSemanticScholar<SemanticScholarSearchResponse>(
    url.toString(),
  );

  return (payload?.data ?? []).filter((paper) =>
    isWithinDateRange(paper, options.dateRangeDays),
  );
}

async function getSemanticScholarPaperById(
  providerPaperId: string,
): Promise<SemanticScholarPaper | null> {
  const paperId = providerPaperId.replace(/^semantic_scholar:/i, "").trim();
  if (!paperId) {
    return null;
  }

  const url = `${GRAPH_BASE_URL}/paper/${encodeURIComponent(paperId)}?fields=${SEARCH_PAPER_FIELDS}`;
  return fetchSemanticScholar<SemanticScholarPaper>(url);
}

async function lookupPaperById(paperId: string): Promise<SemanticScholarPaper | null> {
  const url = `${GRAPH_BASE_URL}/paper/${encodeURIComponent(paperId)}?fields=${PAPER_FIELDS}`;
  return fetchSemanticScholar<SemanticScholarPaper>(url);
}

async function lookupPaperByTitle(title: string): Promise<SemanticScholarPaper | null> {
  const url = `${GRAPH_BASE_URL}/paper/search/match?query=${encodeURIComponent(title)}&fields=${PAPER_FIELDS}`;
  const payload = await fetchSemanticScholar<{ data?: SemanticScholarPaper[] }>(url);
  return payload?.data?.[0] ?? null;
}

async function resolveSemanticScholarPaper(
  paper: LiteraturePaper,
): Promise<SemanticScholarPaper | null> {
  for (const lookupId of buildLookupIds(paper)) {
    const match = await lookupPaperById(lookupId);
    if (match) {
      return match;
    }
  }

  const title = paper.title.trim();
  if (!title) {
    return null;
  }

  return lookupPaperByTitle(title);
}

async function fetchReferences(
  paperId: string,
): Promise<PaperCitationNetworkItem[]> {
  const url = `${GRAPH_BASE_URL}/paper/${encodeURIComponent(paperId)}/references?fields=${LIST_ITEM_FIELDS}&limit=${NETWORK_LIST_LIMIT}`;
  const payload = await fetchSemanticScholar<{ data?: SemanticScholarReferenceEntry[] }>(
    url,
  );

  return (payload?.data ?? [])
    .map((entry) => mapNetworkItem(entry.citedPaper))
    .filter((item): item is PaperCitationNetworkItem => item !== null);
}

async function fetchCitations(
  paperId: string,
): Promise<PaperCitationNetworkItem[]> {
  const url = `${GRAPH_BASE_URL}/paper/${encodeURIComponent(paperId)}/citations?fields=${LIST_ITEM_FIELDS}&limit=${NETWORK_LIST_LIMIT}`;
  const payload = await fetchSemanticScholar<{ data?: SemanticScholarCitationEntry[] }>(
    url,
  );

  return (payload?.data ?? [])
    .map((entry) => mapNetworkItem(entry.citingPaper))
    .filter((item): item is PaperCitationNetworkItem => item !== null);
}

async function fetchRelatedPapers(
  paperId: string,
): Promise<PaperCitationNetworkItem[]> {
  const url = `${RECOMMENDATIONS_BASE_URL}/papers/forpaper/${encodeURIComponent(paperId)}?fields=${LIST_ITEM_FIELDS}&limit=${NETWORK_LIST_LIMIT}`;
  const payload = await fetchSemanticScholar<{ recommendedPapers?: SemanticScholarPaper[] }>(
    url,
  );

  return (payload?.recommendedPapers ?? [])
    .map((entry) => mapNetworkItem(entry))
    .filter((item): item is PaperCitationNetworkItem => item !== null);
}

function emptyCitationNetwork(): PaperCitationNetwork {
  return {
    citationCount: null,
    referenceCount: null,
    influentialCitationCount: null,
    references: [],
    citations: [],
    relatedPapers: [],
  };
}

export async function fetchPaperCitationNetwork(
  paper: LiteraturePaper,
): Promise<PaperCitationNetwork> {
  const resolvedPaper = await resolveSemanticScholarPaper(paper);

  if (!resolvedPaper?.paperId) {
    return emptyCitationNetwork();
  }

  const lookupId = resolvedPaper.paperId;

  const [references, citations, relatedPapers] = await Promise.all([
    fetchReferences(lookupId),
    fetchCitations(lookupId),
    fetchRelatedPapers(lookupId),
  ]);

  return {
    citationCount:
      typeof resolvedPaper.citationCount === "number"
        ? resolvedPaper.citationCount
        : null,
    referenceCount:
      typeof resolvedPaper.referenceCount === "number"
        ? resolvedPaper.referenceCount
        : null,
    influentialCitationCount:
      typeof resolvedPaper.influentialCitationCount === "number"
        ? resolvedPaper.influentialCitationCount
        : null,
    references,
    citations,
    relatedPapers,
  };
}

export const semanticScholarProvider: LiteratureProvider = {
  id: "semantic_scholar",
  name: "Semantic Scholar",
  enabled: true,

  async searchPapers(options) {
    return searchSemanticScholarPapers(options);
  },

  async getPaper(providerPaperId) {
    return getSemanticScholarPaperById(providerPaperId);
  },

  normalizePaper(raw) {
    const paper = normalizeSemanticScholarPaper(raw as SemanticScholarPaper);
    if (!paper) {
      throw new LiteratureError("Invalid Semantic Scholar paper payload.", 502);
    }
    return paper;
  },
};
