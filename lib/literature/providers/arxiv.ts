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

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const ARXIV_USER_AGENT = "ResearchGPT/1.0 (https://github.com/researchgpt)";

type ArxivEntryRaw = {
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string | null;
  pdfUrl: string;
  absUrl: string;
  categories: string[];
};

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

function formatArxivDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function buildArxivSearchQuery(options: {
  keywords: string;
  excludeKeywords: string;
  dateRangeDays?: number;
}): string {
  const keywordTerms = options.keywords
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => `all:"${term.replace(/"/g, "")}"`);

  const excludeTerms = options.excludeKeywords
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => `ANDNOT all:"${term.replace(/"/g, "")}"`);

  const keywordClause =
    keywordTerms.length === 0
      ? "all:*"
      : keywordTerms.length === 1
        ? keywordTerms[0]!
        : `(${keywordTerms.join(" OR ")})`;

  const queryParts = [keywordClause, ...excludeTerms];
  const dateRangeDays = options.dateRangeDays ?? LITERATURE_DATE_RANGE_DAYS;

  if (dateRangeDays !== 0) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setUTCDate(endDate.getUTCDate() - dateRangeDays);
    queryParts.push(
      `submittedDate:[${formatArxivDate(startDate)} TO ${formatArxivDate(endDate)}]`,
    );
  }

  return queryParts.join(" ");
}

function extractArxivId(entryId: string): string {
  const match = entryId.match(/arxiv\.org\/abs\/([^/?#]+)/i);
  return match?.[1] ?? entryId;
}

function parseArxivEntries(xml: string): ArxivEntryRaw[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const papers: ArxivEntryRaw[] = [];

  for (const entry of entries) {
    const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = entry.match(/<published>([\s\S]*?)<\/published>/);

    if (!idMatch || !titleMatch || !summaryMatch) {
      continue;
    }

    const arxivId = extractArxivId(decodeXml(idMatch[1] ?? ""));

    papers.push({
      arxivId,
      title: decodeXml(titleMatch[1] ?? ""),
      abstract: decodeXml(summaryMatch[1] ?? ""),
      authors: [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((match) =>
        decodeXml(match[1] ?? ""),
      ),
      publishedAt: publishedMatch ? decodeXml(publishedMatch[1] ?? "") : null,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
      categories: [...entry.matchAll(/term="([^"]+)"/g)]
        .map((match) => match[1] ?? "")
        .filter(Boolean),
    });
  }

  return papers;
}

function normalizeArxivEntry(raw: ArxivEntryRaw): UnifiedPaper {
  return {
    provider: "arxiv",
    providerPaperId: raw.arxivId,
    externalKey: buildExternalKey("arxiv", raw.arxivId),
    title: raw.title,
    abstract: raw.abstract,
    authors: raw.authors,
    publishedAt: raw.publishedAt,
    pdfUrl: raw.pdfUrl,
    absUrl: raw.absUrl,
    categories: raw.categories,
    doi: null,
    arxivId: raw.arxivId,
    pubmedId: null,
    openAlexId: null,
    citationCount: null,
  };
}

async function fetchArxivEntries(
  options: ProviderSearchOptions,
): Promise<ArxivEntryRaw[]> {
  const searchQuery = buildArxivSearchQuery(options);
  const maxResults = Math.min(
    options.maxResults ?? LITERATURE_MAX_ARXIV_RESULTS,
    LITERATURE_MAX_ARXIV_RESULTS,
  );

  const url = new URL(ARXIV_API_URL);
  url.searchParams.set("search_query", searchQuery);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");

  console.log("[arxiv] request url:", url.toString());
  console.log("[arxiv] search_query:", searchQuery);

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      headers: {
        "User-Agent": ARXIV_USER_AGENT,
      },
      next: { revalidate: 0 },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new LiteratureError(`arXiv 请求失败：${reason}`, 502);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error("[arxiv] non-ok response:", response.status, body.slice(0, 500));
    throw new LiteratureError(`arXiv API 返回 ${response.status}。`, 502);
  }

  const xml = await response.text();
  return parseArxivEntries(xml);
}

export const arxivProvider: LiteratureProvider = {
  id: "arxiv",
  name: "arXiv",
  enabled: true,

  async searchPapers(options) {
    return fetchArxivEntries(options);
  },

  async getPaper(providerPaperId) {
    const entries = await fetchArxivEntries({
      keywords: providerPaperId.replace(/^arxiv:/i, ""),
      excludeKeywords: "",
      maxResults: 1,
    });

    return entries.find((entry) => entry.arxivId === providerPaperId) ?? null;
  },

  normalizePaper(raw) {
    return normalizeArxivEntry(raw as ArxivEntryRaw);
  },
};

export async function fetchArxivPapers(options: {
  keywords: string;
  excludeKeywords: string;
  dateRangeDays?: number;
  maxResults?: number;
}): Promise<ArxivPaperDraft[]> {
  const papers = await searchArxivPapers(options);
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

export async function searchArxivPapers(
  options: ProviderSearchOptions,
): Promise<UnifiedPaper[]> {
  const entries = await arxivProvider.searchPapers(options);

  return entries
    .map((entry) => arxivProvider.normalizePaper(entry))
    .filter((paper) => !matchesExcludeKeywords(paper, options.excludeKeywords));
}
