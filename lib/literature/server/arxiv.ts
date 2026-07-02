// Server-only module.

import {
  LITERATURE_DATE_RANGE_DAYS,
  LITERATURE_MAX_ARXIV_RESULTS,
} from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import type { ArxivPaperDraft } from "@/lib/literature/types";

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const ARXIV_USER_AGENT = "ResearchGPT/1.0 (https://github.com/researchgpt)";

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

  const dateRangeDays = options.dateRangeDays ?? LITERATURE_DATE_RANGE_DAYS;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setUTCDate(endDate.getUTCDate() - dateRangeDays);

  const keywordClause =
    keywordTerms.length === 0
      ? "all:*"
      : keywordTerms.length === 1
        ? keywordTerms[0]!
        : `(${keywordTerms.join(" OR ")})`;

  const dateClause = `submittedDate:[${formatArxivDate(startDate)} TO ${formatArxivDate(endDate)}]`;

  return [keywordClause, ...excludeTerms, dateClause].join(" ");
}

function extractArxivId(entryId: string): string {
  const match = entryId.match(/arxiv\.org\/abs\/([^/?#]+)/i);
  return match?.[1] ?? entryId;
}

function parseArxivEntries(xml: string): ArxivPaperDraft[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const papers: ArxivPaperDraft[] = [];

  for (const entry of entries) {
    const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/);
    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/);
    const publishedMatch = entry.match(/<published>([\s\S]*?)<\/published>/);

    if (!idMatch || !titleMatch || !summaryMatch) {
      continue;
    }

    const arxivId = extractArxivId(decodeXml(idMatch[1] ?? ""));
    const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(
      (match) => decodeXml(match[1] ?? ""),
    );
    const categories = [...entry.matchAll(/term="([^"]+)"/g)]
      .map((match) => match[1] ?? "")
      .filter(Boolean);

    papers.push({
      arxivId,
      title: decodeXml(titleMatch[1] ?? ""),
      abstract: decodeXml(summaryMatch[1] ?? ""),
      authors,
      publishedAt: publishedMatch ? decodeXml(publishedMatch[1] ?? "") : null,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
      categories,
    });
  }

  return papers;
}

export async function fetchArxivPapers(options: {
  keywords: string;
  excludeKeywords: string;
  dateRangeDays?: number;
  maxResults?: number;
}): Promise<ArxivPaperDraft[]> {
  const searchQuery = buildArxivSearchQuery(options);
  const maxResults = options.maxResults ?? LITERATURE_MAX_ARXIV_RESULTS;

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
    throw new LiteratureError(`Failed to reach arXiv: ${reason}`, 502);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error(
      "[arxiv] non-ok response:",
      response.status,
      body.slice(0, 500),
    );
    throw new LiteratureError(
      `arXiv API returned ${response.status}.`,
      502,
    );
  }

  const xml = await response.text();
  const papers = parseArxivEntries(xml);

  if (papers.length === 0) {
    throw new LiteratureError(
      "No arXiv papers matched your keywords in the selected date range.",
      404,
    );
  }

  return papers;
}
