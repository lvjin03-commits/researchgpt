// Server-only module.

import { LiteratureError } from "@/lib/literature/errors";
import { getPaperDoi } from "@/lib/literature/paper-display";
import type {
  LiteraturePaper,
  PaperCitationNetwork,
  PaperCitationNetworkItem,
} from "@/lib/literature/types";

const GRAPH_BASE_URL = "https://api.semanticscholar.org/graph/v1";
const RECOMMENDATIONS_BASE_URL = "https://api.semanticscholar.org/recommendations/v1";
const NETWORK_LIST_LIMIT = 10;

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
  year?: number;
  citationCount?: number;
  referenceCount?: number;
  influentialCitationCount?: number;
  fieldsOfStudy?: string[];
  externalIds?: Record<string, string>;
  url?: string;
  authors?: SemanticScholarAuthor[];
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
  const response = await fetch(url, {
    headers: buildRequestHeaders(),
    cache: "no-store",
  });

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
