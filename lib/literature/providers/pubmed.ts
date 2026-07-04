// Server-only module.

import {
  LITERATURE_DATE_RANGE_DAYS,
  LITERATURE_MAX_ARXIV_RESULTS,
} from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import {
  buildExternalKey,
  matchesExcludeKeywords,
  type LiteratureProvider,
  type ProviderSearchOptions,
  type UnifiedPaper,
} from "@/lib/literature/providers/base";
import type { ArxivPaperDraft } from "@/lib/literature/types";

const ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const NCBI_TOOL = "ResearchGPT";
const NCBI_EMAIL =
  process.env.NCBI_EMAIL?.trim() || "researchgpt@example.com";

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPubMedDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function buildPubMedSearchTerm(options: {
  keywords: string;
  excludeKeywords: string;
}): string {
  const keywordTerms = options.keywords
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);

  const excludeTerms = options.excludeKeywords
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);

  if (keywordTerms.length === 0) {
    throw new LiteratureError("Keywords are required.", 400);
  }

  const keywordClause =
    keywordTerms.length === 1
      ? keywordTerms[0]!
      : `(${keywordTerms.join(" OR ")})`;

  return excludeTerms.reduce(
    (query, term) => `${query} NOT ${term}`,
    keywordClause,
  );
}

function extractTagValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXml(match[1] ?? "") : null;
}

function extractAuthors(articleXml: string): string[] {
  const authorBlocks = articleXml.match(/<Author[\s\S]*?<\/Author>/g) ?? [];

  return authorBlocks
    .map((authorXml) => {
      const collective = extractTagValue(authorXml, "CollectiveName");
      if (collective) {
        return collective;
      }

      const lastName = extractTagValue(authorXml, "LastName");
      const foreName = extractTagValue(authorXml, "ForeName");

      return [foreName, lastName].filter(Boolean).join(" ").trim();
    })
    .filter(Boolean);
}

function extractAbstract(articleXml: string): string {
  const abstractTexts = [
    ...articleXml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g),
  ]
    .map((match) => decodeXml(match[1] ?? ""))
    .filter(Boolean);

  if (abstractTexts.length > 0) {
    return abstractTexts.join("\n\n");
  }

  return extractTagValue(articleXml, "Abstract") ?? "";
}

function extractPublicationTypes(articleXml: string): string[] {
  return [
    ...articleXml.matchAll(/<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g),
  ]
    .map((match) => decodeXml(match[1] ?? ""))
    .filter(Boolean);
}

function extractPublishedAt(articleXml: string): string | null {
  const pubDateMatch = articleXml.match(/<PubDate>([\s\S]*?)<\/PubDate>/);
  if (!pubDateMatch) {
    return null;
  }

  const pubDateXml = pubDateMatch[1] ?? "";
  const year = extractTagValue(pubDateXml, "Year");
  const month = extractTagValue(pubDateXml, "Month");
  const day = extractTagValue(pubDateXml, "Day");

  if (!year) {
    return null;
  }

  const monthNumber = normalizePubMedMonth(month);
  const safeDay = day && /^\d+$/.test(day) ? day.padStart(2, "0") : "01";

  if (monthNumber) {
    return `${year}-${monthNumber}-${safeDay}`;
  }

  return year;
}

function normalizePubMedMonth(value: string | null): string | null {
  if (!value) {
    return "01";
  }

  if (/^\d+$/.test(value)) {
    return value.padStart(2, "0");
  }

  const monthMap: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  return monthMap[value.slice(0, 3).toLowerCase()] ?? "01";
}

function parsePubMedArticles(xml: string): PubMedArticleRaw[] {
  const articles = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) ?? [];
  const papers: PubMedArticleRaw[] = [];

  for (const articleXml of articles) {
    const pmid = extractTagValue(articleXml, "PMID");
    const title = extractTagValue(articleXml, "ArticleTitle");
    const abstract = extractAbstract(articleXml);

    if (!pmid || !title) {
      continue;
    }

    const journalTitle = extractTagValue(articleXml, "Title");
    const categories = extractPublicationTypes(articleXml);

    if (journalTitle) {
      categories.unshift(journalTitle);
    }

    const absUrl = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

    papers.push({
      pmid,
      title,
      abstract: abstract || "暂无摘要。",
      authors: extractAuthors(articleXml),
      publishedAt: extractPublishedAt(articleXml),
      pdfUrl: absUrl,
      absUrl,
      categories,
    });
  }

  return papers;
}

type PubMedArticleRaw = {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string | null;
  pdfUrl: string;
  absUrl: string;
  categories: string[];
};

function normalizePubMedArticle(raw: PubMedArticleRaw): UnifiedPaper {
  return {
    provider: "pubmed",
    providerPaperId: raw.pmid,
    externalKey: buildExternalKey("pubmed", raw.pmid),
    title: raw.title,
    abstract: raw.abstract,
    authors: raw.authors,
    publishedAt: raw.publishedAt,
    pdfUrl: raw.pdfUrl,
    absUrl: raw.absUrl,
    categories: raw.categories,
    doi: null,
    arxivId: null,
    pubmedId: raw.pmid,
    openAlexId: null,
    openReviewId: null,
    citationCount: null,
    providers: ["pubmed"],
    sourceUrls: { pubmed: raw.absUrl },
  };
}

async function searchPubMedIds(options: {
  keywords: string;
  excludeKeywords: string;
  dateRangeDays?: number;
  maxResults: number;
}): Promise<string[]> {
  const term = buildPubMedSearchTerm(options);
  const url = new URL(ESEARCH_URL);

  url.searchParams.set("db", "pubmed");
  url.searchParams.set("term", term);
  url.searchParams.set("retmode", "json");
  url.searchParams.set("retmax", String(options.maxResults));
  url.searchParams.set("sort", "pub+date");
  url.searchParams.set("tool", NCBI_TOOL);
  url.searchParams.set("email", NCBI_EMAIL);

  const dateRangeDays = options.dateRangeDays ?? LITERATURE_DATE_RANGE_DAYS;

  if (dateRangeDays !== 0) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(endDate.getUTCDate() - dateRangeDays);
    url.searchParams.set("datetype", "pdat");
    url.searchParams.set("mindate", formatPubMedDate(startDate));
    url.searchParams.set("maxdate", formatPubMedDate(endDate));
  }

  console.log("[pubmed] esearch url:", url.toString());
  console.log("[pubmed] term:", term);

  let response: Response;

  try {
    response = await fetch(url.toString(), { next: { revalidate: 0 } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new LiteratureError(`Failed to reach PubMed: ${reason}`, 502);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(
      "[pubmed] esearch non-ok response:",
      response.status,
      body.slice(0, 500),
    );
    throw new LiteratureError(
      `PubMed search API returned ${response.status}.`,
      502,
    );
  }

  const payload = (await response.json()) as {
    esearchresult?: { idlist?: string[] };
  };

  return payload.esearchresult?.idlist ?? [];
}

async function fetchPubMedRecords(ids: string[]): Promise<PubMedArticleRaw[]> {
  const url = new URL(EFETCH_URL);

  url.searchParams.set("db", "pubmed");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("retmode", "xml");
  url.searchParams.set("tool", NCBI_TOOL);
  url.searchParams.set("email", NCBI_EMAIL);

  console.log("[pubmed] efetch ids:", ids.join(", "));

  let response: Response;

  try {
    response = await fetch(url.toString(), { next: { revalidate: 0 } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new LiteratureError(`Failed to reach PubMed: ${reason}`, 502);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(
      "[pubmed] efetch non-ok response:",
      response.status,
      body.slice(0, 500),
    );
    throw new LiteratureError(
      `PubMed fetch API returned ${response.status}.`,
      502,
    );
  }

  const xml = await response.text();
  return parsePubMedArticles(xml);
}

export const pubmedProvider: LiteratureProvider = {
  id: "pubmed",
  name: "PubMed",
  enabled: true,

  async searchPapers(options) {
    const maxResults = Math.min(
      options.maxResults ?? LITERATURE_MAX_ARXIV_RESULTS,
      LITERATURE_MAX_ARXIV_RESULTS,
    );

    const ids = await searchPubMedIds({
      ...options,
      maxResults,
    });

    if (ids.length === 0) {
      return [];
    }

    return fetchPubMedRecords(ids.slice(0, maxResults));
  },

  async getPaper(providerPaperId) {
    const pmid = providerPaperId.replace(/^pubmed:/i, "");
    const records = await fetchPubMedRecords([pmid]);
    return records[0] ?? null;
  },

  normalizePaper(raw) {
    return normalizePubMedArticle(raw as PubMedArticleRaw);
  },
};

export async function searchPubMedUnifiedPapers(
  options: ProviderSearchOptions,
): Promise<UnifiedPaper[]> {
  const articles = await pubmedProvider.searchPapers(options);

  return articles
    .map((article) => pubmedProvider.normalizePaper(article))
    .filter((paper) => !matchesExcludeKeywords(paper, options.excludeKeywords));
}

export async function fetchPubMedPapers(options: {
  keywords: string;
  excludeKeywords: string;
  dateRangeDays?: number;
  maxResults?: number;
}): Promise<ArxivPaperDraft[]> {
  const papers = await searchPubMedUnifiedPapers(options);

  return papers.map((paper) => ({
    arxivId: paper.externalKey,
    title: paper.title,
    abstract: paper.abstract,
    authors: paper.authors,
    publishedAt: paper.publishedAt,
    pdfUrl: paper.pdfUrl,
    absUrl: paper.absUrl,
    categories: paper.categories,
  }));
}
