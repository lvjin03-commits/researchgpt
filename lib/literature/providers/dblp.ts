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

const DBLP_SEARCH_URL = "https://dblp.org/search/publ/api";
const DBLP_USER_AGENT = "ResearchGPT/1.0 (https://github.com/researchgpt; literature tracker)";

type DblpAuthor = {
  "@pid"?: string;
  text?: string;
};

type DblpPublicationInfo = {
  authors?: {
    author?: DblpAuthor | DblpAuthor[];
  };
  title?: string;
  venue?: string;
  year?: string | number;
  type?: string;
  doi?: string;
  ee?: string | string[];
  url?: string;
  key?: string;
  pages?: string;
  volume?: string;
};

export type DblpSearchHit = {
  "@score"?: string;
  "@id"?: string;
  info?: DblpPublicationInfo;
};

type DblpSearchResponse = {
  result?: {
    hits?: {
      hit?: DblpSearchHit | DblpSearchHit[];
    };
  };
};

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function stripDblpTitle(title: string): string {
  return decodeXml(title).replace(/\s*\.\s*$/, "").trim();
}

function extractDblpAuthors(info: DblpPublicationInfo): string[] {
  const rawAuthors = info.authors?.author;
  if (!rawAuthors) {
    return [];
  }

  const authors = Array.isArray(rawAuthors) ? rawAuthors : [rawAuthors];

  return authors
    .map((author) => author.text?.trim())
    .filter((name): name is string => Boolean(name));
}

function extractDblpDoi(info: DblpPublicationInfo): string | null {
  if (info.doi) {
    return normalizeDoi(info.doi);
  }

  const eeValues = Array.isArray(info.ee) ? info.ee : info.ee ? [info.ee] : [];
  for (const value of eeValues) {
    const doi = normalizeDoi(value);
    if (doi) {
      return doi;
    }
  }

  return null;
}

function yearToPublishedAt(year: string | number | undefined): string | null {
  if (year === undefined || year === null) {
    return null;
  }

  const parsed = Number(String(year).trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return new Date(Date.UTC(parsed, 0, 1)).toISOString();
}

function extractAbsUrl(info: DblpPublicationInfo): string {
  if (info.url?.trim()) {
    return info.url.trim();
  }

  const doi = extractDblpDoi(info);
  if (doi) {
    return `https://doi.org/${doi}`;
  }

  if (info.key?.trim()) {
    return `https://dblp.org/rec/${info.key.trim()}`;
  }

  return "https://dblp.org";
}

function extractPdfUrl(info: DblpPublicationInfo, absUrl: string): string {
  const eeValues = Array.isArray(info.ee) ? info.ee : info.ee ? [info.ee] : [];

  for (const value of eeValues) {
    const url = value.trim();
    if (/\.pdf($|\?)/i.test(url) || url.includes("arxiv.org/pdf/")) {
      return url;
    }
  }

  return absUrl;
}

function buildDblpCategories(info: DblpPublicationInfo): string[] {
  const categories: string[] = [];

  if (info.venue?.trim()) {
    categories.push(info.venue.trim());
  }

  if (info.type?.trim()) {
    categories.push(info.type.trim());
  }

  const doi = extractDblpDoi(info);
  if (doi && !categories.some((item) => item.toLowerCase().startsWith("doi:"))) {
    categories.unshift(`doi:${doi}`);
  }

  return categories;
}

function buildDblpSearchQuery(options: ProviderSearchOptions): string {
  const keywords = options.keywords.trim();
  const dateRangeDays = options.dateRangeDays ?? LITERATURE_DATE_RANGE_DAYS;

  if (!keywords) {
    return "";
  }

  if (dateRangeDays === 0) {
    return keywords;
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setUTCDate(endDate.getUTCDate() - dateRangeDays);
  const startYear = startDate.getUTCFullYear();
  const endYear = endDate.getUTCFullYear();

  if (startYear === endYear) {
    return `${keywords} year:${startYear}`;
  }

  return `${keywords} year:${startYear}-${endYear}`;
}

function normalizeDblpHits(raw: DblpSearchHit | DblpSearchHit[] | undefined): DblpSearchHit[] {
  if (!raw) {
    return [];
  }

  return Array.isArray(raw) ? raw : [raw];
}

function paperWithinDateRange(
  publishedAt: string | null,
  dateRangeDays: number | undefined,
): boolean {
  if (!dateRangeDays || dateRangeDays === 0 || !publishedAt) {
    return true;
  }

  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) {
    return true;
  }

  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - dateRangeDays);
  return publishedTime >= startDate.getTime();
}

function normalizeDblpPublication(info: DblpPublicationInfo): UnifiedPaper | null {
  const dblpKey = info.key?.trim();
  const title = info.title ? stripDblpTitle(info.title) : "";

  if (!dblpKey || !title) {
    return null;
  }

  const doi = extractDblpDoi(info);
  const absUrl = extractAbsUrl(info);
  const pdfUrl = extractPdfUrl(info, absUrl);
  const publishedAt = yearToPublishedAt(info.year);

  return {
    provider: "dblp",
    providerPaperId: dblpKey,
    externalKey: buildExternalKey("dblp", dblpKey),
    title,
    abstract: "暂无摘要。",
    authors: extractDblpAuthors(info),
    publishedAt,
    pdfUrl,
    absUrl,
    categories: buildDblpCategories(info),
    doi,
    arxivId: null,
    pubmedId: null,
    openAlexId: null,
    citationCount: null,
    providers: ["dblp"],
    sourceUrls: { dblp: absUrl },
  };
}

function parseDblpRecordXml(xml: string): DblpPublicationInfo | null {
  const recordMatch = xml.match(
    /<(?:inproceedings|article|proceedings|book|incollection|phdthesis|mastersthesis)[^>]*key="([^"]+)"[\s\S]*?<\/(?:inproceedings|article|proceedings|book|incollection|phdthesis|mastersthesis)>/i,
  );

  if (!recordMatch) {
    return null;
  }

  const recordXml = recordMatch[0]!;
  const key = recordMatch[1] ?? "";

  const title = extractTagValue(recordXml, "title");
  const year = extractTagValue(recordXml, "year");
  const venue =
    extractTagValue(recordXml, "journal") ||
    extractTagValue(recordXml, "booktitle");
  const doi = extractTagValue(recordXml, "doi");
  const url = extractTagValue(recordXml, "url");
  const eeMatches = [...recordXml.matchAll(/<ee[^>]*>([\s\S]*?)<\/ee>/g)].map(
    (match) => decodeXml(match[1] ?? ""),
  );
  const authors = [...recordXml.matchAll(/<author[^>]*>([\s\S]*?)<\/author>/g)]
    .map((match) => decodeXml(match[1] ?? ""))
    .filter(Boolean);

  return {
    key,
    title: title ?? undefined,
    year: year ?? undefined,
    venue: venue ?? undefined,
    doi: doi ?? undefined,
    url: url ? `https://dblp.org/${url.replace(/^\/+/, "")}` : undefined,
    ee: eeMatches.length > 0 ? eeMatches : undefined,
    authors: authors.length > 0 ? { author: authors.map((text) => ({ text })) } : undefined,
    type: recordXml.includes("<article ")
      ? "Journal Articles"
      : "Conference and Workshop Papers",
  };
}

function extractTagValue(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1] ?? "") : null;
}

async function fetchDblpSearchHits(
  options: ProviderSearchOptions,
): Promise<DblpSearchHit[]> {
  const query = buildDblpSearchQuery(options);
  if (!query) {
    return [];
  }

  const maxResults = Math.min(
    options.maxResults ?? LITERATURE_MAX_ARXIV_RESULTS,
    LITERATURE_MAX_ARXIV_RESULTS,
  );

  const url = new URL(DBLP_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("h", String(maxResults));

  console.log("[dblp] search url:", url.toString());

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": DBLP_USER_AGENT,
      },
      next: { revalidate: 0 },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    throw new LiteratureError(`DBLP 请求失败：${reason}`, 502);
  }

  if (!response.ok) {
    const body = await response.text();
    console.error("[dblp] non-ok response:", response.status, body.slice(0, 500));
    throw new LiteratureError(`DBLP API 返回 ${response.status}。`, 502);
  }

  const payload = (await response.json()) as DblpSearchResponse;
  const hits = normalizeDblpHits(payload.result?.hits?.hit);

  return hits.filter((hit) =>
    paperWithinDateRange(
      yearToPublishedAt(hit.info?.year),
      options.dateRangeDays,
    ),
  );
}

async function fetchDblpRecordByKey(key: string): Promise<DblpPublicationInfo | null> {
  const dblpKey = key.replace(/^dblp:/i, "").replace(/^rec\//i, "");
  const url = `https://dblp.org/rec/${dblpKey}.xml`;

  let response: Response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/xml",
        "User-Agent": DBLP_USER_AGENT,
      },
      next: { revalidate: 0 },
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const xml = await response.text();
  return parseDblpRecordXml(xml);
}

export const dblpProvider: LiteratureProvider = {
  id: "dblp",
  name: "DBLP",
  enabled: true,

  async searchPapers(options) {
    const hits = await fetchDblpSearchHits(options);
    return hits
      .map((hit) => hit.info)
      .filter((info): info is DblpPublicationInfo => Boolean(info));
  },

  async getPaper(providerPaperId) {
    return fetchDblpRecordByKey(providerPaperId);
  },

  normalizePaper(raw) {
    const paper = normalizeDblpPublication(raw as DblpPublicationInfo);
    if (!paper) {
      throw new LiteratureError("Invalid DBLP paper payload.", 502);
    }
    return paper;
  },
};
