// Server-only module.

import { LITERATURE_DATE_RANGE_DAYS, LITERATURE_MAX_ARXIV_RESULTS } from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import {
  buildExternalKey,
  matchesExcludeKeywords,
  normalizeArxivId,
  normalizeDoi,
  normalizePubmedId,
  type LiteratureProvider,
  type ProviderSearchOptions,
  type UnifiedPaper,
} from "@/lib/literature/providers/base";

const OPENALEX_API_URL = "https://api.openalex.org/works";
const OPENALEX_MAILTO =
  process.env.OPENALEX_MAILTO?.trim() ||
  process.env.NCBI_EMAIL?.trim() ||
  "researchgpt@example.com";

type OpenAlexAuthor = {
  author?: {
    display_name?: string | null;
  } | null;
};

type OpenAlexWork = {
  id?: string;
  display_name?: string | null;
  title?: string | null;
  doi?: string | null;
  publication_date?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: OpenAlexAuthor[] | null;
  cited_by_count?: number | null;
  primary_location?: {
    pdf_url?: string | null;
    landing_page_url?: string | null;
    source?: {
      display_name?: string | null;
    } | null;
  } | null;
  topics?: Array<{ display_name?: string | null }> | null;
  ids?: {
    openalex?: string | null;
    doi?: string | null;
    pmid?: string | null;
    arxiv?: string | null;
  } | null;
};

type OpenAlexSearchResponse = {
  results?: OpenAlexWork[];
};

function extractOpenAlexId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\/(W\d+)\/?$/i);
  return match?.[1] ?? null;
}

function abstractFromInvertedIndex(
  index: Record<string, number[]> | null | undefined,
): string {
  if (!index) {
    return "";
  }

  const tokens: Array<[number, string]> = [];

  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      tokens.push([position, word]);
    }
  }

  tokens.sort((left, right) => left[0] - right[0]);
  return tokens.map((entry) => entry[1]).join(" ");
}

function formatOpenAlexDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildOpenAlexSearchUrl(options: ProviderSearchOptions): string {
  const url = new URL(OPENALEX_API_URL);
  url.searchParams.set("search", options.keywords.trim());
  url.searchParams.set(
    "per-page",
    String(Math.min(options.maxResults ?? LITERATURE_MAX_ARXIV_RESULTS, 50)),
  );
  url.searchParams.set("sort", "publication_date:desc");
  url.searchParams.set("mailto", OPENALEX_MAILTO);

  const dateRangeDays = options.dateRangeDays ?? LITERATURE_DATE_RANGE_DAYS;

  if (dateRangeDays !== 0) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(endDate.getUTCDate() - dateRangeDays);
    url.searchParams.set(
      "filter",
      `from_publication_date:${formatOpenAlexDate(startDate)},to_publication_date:${formatOpenAlexDate(endDate)}`,
    );
  }

  return url.toString();
}

function normalizeOpenAlexWork(raw: OpenAlexWork): UnifiedPaper | null {
  const openAlexId =
    extractOpenAlexId(raw.ids?.openalex ?? raw.id) ??
    extractOpenAlexId(raw.id ?? null);

  if (!openAlexId) {
    return null;
  }

  const title = (raw.display_name ?? raw.title ?? "").trim();
  if (!title) {
    return null;
  }

  const doi = normalizeDoi(raw.doi ?? raw.ids?.doi ?? null);
  const arxivId = normalizeArxivId(raw.ids?.arxiv ?? null);
  const pubmedId = normalizePubmedId(raw.ids?.pmid ?? null);

  const absUrl =
    raw.primary_location?.landing_page_url ??
    `https://openalex.org/${openAlexId}`;
  const pdfUrl = raw.primary_location?.pdf_url ?? absUrl;

  const categories = [
    ...(raw.topics ?? [])
      .map((topic) => topic.display_name?.trim())
      .filter((value): value is string => Boolean(value)),
  ];

  const journal = raw.primary_location?.source?.display_name?.trim();
  if (journal) {
    categories.unshift(journal);
  }

  return {
    provider: "openalex",
    providerPaperId: openAlexId,
    externalKey: buildExternalKey("openalex", openAlexId),
    title,
    abstract: abstractFromInvertedIndex(raw.abstract_inverted_index),
    authors: (raw.authorships ?? [])
      .map((entry) => entry.author?.display_name?.trim())
      .filter((name): name is string => Boolean(name)),
    publishedAt: raw.publication_date ?? null,
    pdfUrl,
    absUrl,
    categories,
    doi,
    arxivId,
    pubmedId,
    openAlexId,
    citationCount:
      typeof raw.cited_by_count === "number" ? raw.cited_by_count : null,
    providers: ["openalex"],
    sourceUrls: { openalex: absUrl },
  };
}

async function fetchOpenAlexWorks(
  options: ProviderSearchOptions,
): Promise<OpenAlexWork[]> {
  const url = buildOpenAlexSearchUrl(options);

  console.log("[openalex] search url:", url);

  let response: Response;

  try {
    response = await fetch(url, { next: { revalidate: 0 } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new LiteratureError(`OpenAlex 请求失败：${reason}`, 502);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error("[openalex] non-ok response:", response.status, body.slice(0, 500));
    throw new LiteratureError(`OpenAlex API 返回 ${response.status}。`, 502);
  }

  const payload = (await response.json()) as OpenAlexSearchResponse;
  return payload.results ?? [];
}

async function fetchOpenAlexWorkById(
  providerPaperId: string,
): Promise<OpenAlexWork | null> {
  const openAlexId = providerPaperId.replace(/^openalex:/i, "").replace(/^W/i, "W");
  const url = `https://api.openalex.org/works/${openAlexId}?mailto=${encodeURIComponent(OPENALEX_MAILTO)}`;

  let response: Response;

  try {
    response = await fetch(url, { next: { revalidate: 0 } });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as OpenAlexWork;
}

export const openAlexProvider: LiteratureProvider = {
  id: "openalex",
  name: "OpenAlex",
  enabled: true,

  async searchPapers(options) {
    const works = await fetchOpenAlexWorks(options);
    return works;
  },

  async getPaper(providerPaperId) {
    return fetchOpenAlexWorkById(providerPaperId);
  },

  normalizePaper(raw) {
    const paper = normalizeOpenAlexWork(raw as OpenAlexWork);
    if (!paper) {
      throw new LiteratureError("Invalid OpenAlex paper payload.", 502);
    }
    return paper;
  },
};

export async function searchOpenAlexPapers(
  options: ProviderSearchOptions,
): Promise<UnifiedPaper[]> {
  const works = await openAlexProvider.searchPapers(options);

  return works
    .map((work) => {
      try {
        return openAlexProvider.normalizePaper(work);
      } catch {
        return null;
      }
    })
    .filter((paper): paper is UnifiedPaper => paper !== null)
    .filter((paper) => !matchesExcludeKeywords(paper, options.excludeKeywords));
}
