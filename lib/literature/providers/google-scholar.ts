// Server-only module.

import { LITERATURE_MAX_ARXIV_RESULTS } from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import {
  buildExternalKey,
  type LiteratureProvider,
  type ProviderSearchOptions,
  type UnifiedPaper,
} from "@/lib/literature/providers/base";

const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";

type SerpApiScholarAuthor = {
  name?: string;
};

type SerpApiScholarResult = {
  position?: number;
  title?: string;
  result_id?: string;
  link?: string;
  snippet?: string;
  publication_info?: {
    summary?: string;
    authors?: SerpApiScholarAuthor[];
  };
  resources?: Array<{
    title?: string;
    file_format?: string;
    link?: string;
  }>;
  inline_links?: {
    cited_by?: {
      total?: number;
      link?: string;
      cites_id?: string;
    };
    versions?: {
      total?: number;
      link?: string;
      cluster_id?: string;
    };
    related_pages_link?: string;
    html_version?: string;
  };
};

type SerpApiScholarResponse = {
  organic_results?: SerpApiScholarResult[];
  error?: string;
};

function getApiKey(): string {
  const apiKey = process.env.SERPAPI_API_KEY?.trim();
  if (!apiKey) {
    throw new LiteratureError(
      "SERPAPI_API_KEY is required to search Google Scholar.",
      500,
    );
  }

  return apiKey;
}

function buildQuery(options: ProviderSearchOptions): string {
  return [options.researchDirection, options.keywords]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

function startYearFromDateRange(dateRangeDays?: number): string | null {
  if (!dateRangeDays || dateRangeDays <= 0) {
    return null;
  }

  const date = new Date();
  date.setUTCDate(date.getUTCDate() - dateRangeDays);
  return String(date.getUTCFullYear());
}

function buildScholarSearchUrl(options: ProviderSearchOptions): string {
  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", "google_scholar");
  url.searchParams.set("api_key", getApiKey());
  url.searchParams.set("q", buildQuery(options));
  url.searchParams.set(
    "num",
    String(Math.min(options.maxResults ?? LITERATURE_MAX_ARXIV_RESULTS, 20)),
  );
  url.searchParams.set("hl", "en");

  const startYear = startYearFromDateRange(options.dateRangeDays);
  if (startYear) {
    url.searchParams.set("as_ylo", startYear);
  }

  return url.toString();
}

function parseYear(summary: string | undefined): string | null {
  const match = summary?.match(/\b(19|20)\d{2}\b/);
  return match ? `${match[0]}-01-01` : null;
}

function parseAuthors(result: SerpApiScholarResult): string[] {
  const structured = result.publication_info?.authors
    ?.map((author) => author.name?.trim())
    .filter((name): name is string => Boolean(name));

  if (structured && structured.length > 0) {
    return structured;
  }

  const summary = result.publication_info?.summary ?? "";
  const authorSegment = summary.split(" - ")[0] ?? "";

  return authorSegment
    .replace(/\bet al\.?/gi, "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function pickPdfUrl(result: SerpApiScholarResult, fallback: string): string {
  const pdf = result.resources?.find(
    (resource) =>
      resource.file_format?.toLowerCase() === "pdf" && resource.link,
  );

  return pdf?.link ?? fallback;
}

function scholarLandingUrl(result: SerpApiScholarResult): string {
  return (
    result.inline_links?.versions?.link ||
    result.inline_links?.related_pages_link ||
    result.inline_links?.cited_by?.link ||
    `https://scholar.google.com/scholar?q=${encodeURIComponent(
      result.title ?? "",
    )}`
  );
}

function normalizeScholarResult(result: SerpApiScholarResult): UnifiedPaper | null {
  const title = result.title?.trim();
  if (!title) {
    return null;
  }

  const providerPaperId =
    result.result_id ??
    result.inline_links?.versions?.cluster_id ??
    result.inline_links?.cited_by?.cites_id ??
    title;
  const absUrl = scholarLandingUrl(result);
  const summary = result.publication_info?.summary?.trim();
  const categories = ["source:Google Scholar"];

  if (summary) {
    categories.push(summary);
  }

  return {
    provider: "google_scholar",
    providerPaperId,
    externalKey: buildExternalKey("google_scholar", providerPaperId),
    title,
    abstract: result.snippet?.trim() || "No abstract available.",
    authors: parseAuthors(result),
    publishedAt: parseYear(summary),
    pdfUrl: pickPdfUrl(result, absUrl),
    absUrl,
    categories,
    doi: null,
    arxivId: null,
    pubmedId: null,
    openAlexId: null,
    openReviewId: null,
    citationCount:
      typeof result.inline_links?.cited_by?.total === "number"
        ? result.inline_links.cited_by.total
        : null,
    providers: ["google_scholar"],
    sourceUrls: { google_scholar: absUrl },
  };
}

async function fetchScholarResults(
  options: ProviderSearchOptions,
): Promise<SerpApiScholarResult[]> {
  const url = buildScholarSearchUrl(options);

  let response: Response;
  try {
    response = await fetch(url, { next: { revalidate: 0 } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new LiteratureError(`Google Scholar search failed: ${reason}`, 502);
  }

  const payload = (await response.json()) as SerpApiScholarResponse;

  if (!response.ok || payload.error) {
    throw new LiteratureError(
      payload.error ?? `SerpApi returned ${response.status}.`,
      502,
    );
  }

  return payload.organic_results ?? [];
}

export const googleScholarProvider: LiteratureProvider = {
  id: "google_scholar",
  name: "Google Scholar",
  enabled: true,

  async searchPapers(options) {
    return fetchScholarResults(options);
  },

  async getPaper() {
    return null;
  },

  normalizePaper(raw) {
    const paper = normalizeScholarResult(raw as SerpApiScholarResult);
    if (!paper) {
      throw new LiteratureError("Invalid Google Scholar paper payload.", 502);
    }
    return paper;
  },
};
