// Server-only module.

import {
  LITERATURE_DATE_RANGE_DAYS,
  LITERATURE_MAX_ARXIV_RESULTS,
} from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import {
  buildExternalKey,
  normalizeDoi,
  type LiteratureProvider,
  type ProviderSearchOptions,
  type UnifiedPaper,
} from "@/lib/literature/providers/base";

const CROSSREF_API_URL = "https://api.crossref.org/works";
const CROSSREF_MAILTO =
  process.env.CROSSREF_MAILTO?.trim() ||
  process.env.OPENALEX_MAILTO?.trim() ||
  process.env.NCBI_EMAIL?.trim() ||
  "researchgpt@example.com";

type CrossrefDateParts = {
  "date-parts"?: number[][];
};

type CrossrefAuthor = {
  given?: string;
  family?: string;
  name?: string;
};

type CrossrefLink = {
  URL?: string;
  "content-type"?: string;
};

export type CrossrefWork = {
  DOI?: string;
  title?: string[];
  author?: CrossrefAuthor[];
  abstract?: string;
  published?: CrossrefDateParts;
  "published-print"?: CrossrefDateParts;
  "published-online"?: CrossrefDateParts;
  issued?: CrossrefDateParts;
  "container-title"?: string[];
  type?: string;
  link?: CrossrefLink[];
  URL?: string;
  "is-referenced-by-count"?: number;
};

type CrossrefSearchResponse = {
  message?: {
    items?: CrossrefWork[];
  };
};

function formatCrossrefDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function stripAbstractMarkup(value: string): string {
  return value
    .replace(/<jats:[^>]+>/gi, " ")
    .replace(/<\/jats:[^>]+>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function datePartsToIso(parts: number[] | undefined): string | null {
  if (!parts || parts.length === 0) {
    return null;
  }

  const year = parts[0];
  if (typeof year !== "number" || !Number.isFinite(year)) {
    return null;
  }

  const month = typeof parts[1] === "number" ? parts[1] : 1;
  const day = typeof parts[2] === "number" ? parts[2] : 1;
  const date = new Date(Date.UTC(year, Math.max(0, month - 1), day));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function extractPublishedAt(work: CrossrefWork): string | null {
  const candidates = [
    work["published-online"]?.["date-parts"]?.[0],
    work["published-print"]?.["date-parts"]?.[0],
    work.published?.["date-parts"]?.[0],
    work.issued?.["date-parts"]?.[0],
  ];

  for (const parts of candidates) {
    const iso = datePartsToIso(parts);
    if (iso) {
      return iso;
    }
  }

  return null;
}

function extractAuthors(work: CrossrefWork): string[] {
  return (work.author ?? [])
    .map((author) => {
      if (author.name?.trim()) {
        return author.name.trim();
      }

      const given = author.given?.trim() ?? "";
      const family = author.family?.trim() ?? "";
      return `${given} ${family}`.trim();
    })
    .filter(Boolean);
}

function extractPdfUrl(work: CrossrefWork, absUrl: string): string {
  const pdfLink = (work.link ?? []).find(
    (link) =>
      link["content-type"]?.toLowerCase() === "application/pdf" &&
      typeof link.URL === "string" &&
      link.URL.trim().length > 0,
  );

  if (pdfLink?.URL) {
    return pdfLink.URL;
  }

  return absUrl;
}

function buildCrossrefSearchUrl(options: ProviderSearchOptions): string {
  const url = new URL(CROSSREF_API_URL);
  url.searchParams.set("query", options.keywords.trim());
  url.searchParams.set(
    "rows",
    String(Math.min(options.maxResults ?? LITERATURE_MAX_ARXIV_RESULTS, 50)),
  );
  url.searchParams.set("sort", "published");
  url.searchParams.set("order", "desc");
  url.searchParams.set("mailto", CROSSREF_MAILTO);

  const filters: string[] = [];
  const dateRangeDays = options.dateRangeDays ?? LITERATURE_DATE_RANGE_DAYS;

  if (dateRangeDays !== 0) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(endDate.getUTCDate() - dateRangeDays);
    filters.push(`from-pub-date:${formatCrossrefDate(startDate)}`);
    filters.push(`until-pub-date:${formatCrossrefDate(endDate)}`);
  }

  if (filters.length > 0) {
    url.searchParams.set("filter", filters.join(","));
  }

  return url.toString();
}

function normalizeCrossrefWork(raw: CrossrefWork): UnifiedPaper | null {
  const doi = normalizeDoi(raw.DOI ?? null);
  if (!doi) {
    return null;
  }

  const title = (raw.title ?? []).map((item) => item.trim()).find(Boolean);
  if (!title) {
    return null;
  }

  const absUrl = raw.URL?.trim() || `https://doi.org/${doi}`;
  const pdfUrl = extractPdfUrl(raw, absUrl);
  const abstract = raw.abstract
    ? stripAbstractMarkup(raw.abstract)
    : "暂无摘要。";

  const categories: string[] = [];
  const journal = (raw["container-title"] ?? [])
    .map((item) => item.trim())
    .find(Boolean);
  if (journal) {
    categories.push(journal);
  }

  if (raw.type?.trim()) {
    categories.push(raw.type.trim());
  }

  categories.unshift(`doi:${doi}`);

  return {
    provider: "crossref",
    providerPaperId: doi,
    externalKey: buildExternalKey("crossref", doi),
    title,
    abstract,
    authors: extractAuthors(raw),
    publishedAt: extractPublishedAt(raw),
    pdfUrl,
    absUrl,
    categories,
    doi,
    arxivId: null,
    pubmedId: null,
    openAlexId: null,
    openReviewId: null,
    citationCount:
      typeof raw["is-referenced-by-count"] === "number"
        ? raw["is-referenced-by-count"]
        : null,
    providers: ["crossref"],
    sourceUrls: { crossref: absUrl },
  };
}

async function fetchCrossrefWorks(
  options: ProviderSearchOptions,
): Promise<CrossrefWork[]> {
  const url = buildCrossrefSearchUrl(options);

  console.log("[crossref] search url:", url);

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `ResearchGPT/1.0 (mailto:${CROSSREF_MAILTO})`,
      },
      next: { revalidate: 0 },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new LiteratureError(`Crossref 请求失败：${reason}`, 502);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(
      "[crossref] non-ok response:",
      response.status,
      body.slice(0, 500),
    );
    throw new LiteratureError(`Crossref API 返回 ${response.status}。`, 502);
  }

  const payload = (await response.json()) as CrossrefSearchResponse;
  return payload.message?.items ?? [];
}

async function fetchCrossrefWorkByDoi(doi: string): Promise<CrossrefWork | null> {
  const normalizedDoi = normalizeDoi(doi) ?? doi.replace(/^crossref:/i, "");
  const url = `${CROSSREF_API_URL}/${encodeURIComponent(normalizedDoi)}?mailto=${encodeURIComponent(CROSSREF_MAILTO)}`;

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `ResearchGPT/1.0 (mailto:${CROSSREF_MAILTO})`,
      },
      next: { revalidate: 0 },
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { message?: CrossrefWork };
  return payload.message ?? null;
}

export const crossrefProvider: LiteratureProvider = {
  id: "crossref",
  name: "Crossref",
  enabled: true,

  async searchPapers(options) {
    return fetchCrossrefWorks(options);
  },

  async getPaper(providerPaperId) {
    return fetchCrossrefWorkByDoi(providerPaperId);
  },

  normalizePaper(raw) {
    const paper = normalizeCrossrefWork(raw as CrossrefWork);
    if (!paper) {
      throw new LiteratureError("Invalid Crossref paper payload.", 502);
    }
    return paper;
  },
};
