// Server-only module.

import type { ArxivPaperDraft } from "@/lib/literature/types";
import type {
  LiteratureDedupeMatchReason,
  UnifiedPaperDebugRecord,
} from "@/lib/literature/search-debug";

export type { UnifiedPaperDebugRecord, LiteratureDedupeMatchReason };

export type LiteratureProviderId =
  | "openalex"
  | "arxiv"
  | "pubmed"
  | "crossref"
  | "dblp"
  | "openreview"
  | "semantic_scholar";

export type ProviderSearchOptions = {
  keywords: string;
  excludeKeywords: string;
  dateRangeDays?: number;
  maxResults?: number;
};

/** Unified paper model used across literature providers. */
export type UnifiedPaper = {
  provider: LiteratureProviderId;
  providerPaperId: string;
  externalKey: string;
  title: string;
  abstract: string;
  authors: string[];
  publishedAt: string | null;
  pdfUrl: string;
  absUrl: string;
  categories: string[];
  doi: string | null;
  arxivId: string | null;
  pubmedId: string | null;
  openAlexId: string | null;
  citationCount: number | null;
  providers: LiteratureProviderId[];
  sourceUrls: Partial<Record<LiteratureProviderId, string>>;
};

export interface LiteratureProvider {
  readonly id: LiteratureProviderId;
  readonly name: string;
  readonly enabled: boolean;
  searchPapers(options: ProviderSearchOptions): Promise<unknown[]>;
  getPaper(providerPaperId: string): Promise<unknown | null>;
  normalizePaper(raw: unknown): UnifiedPaper;
}

export type DedupeStats = {
  inputCount: number;
  outputCount: number;
  duplicatesRemoved: number;
  exactMatches: number;
  fuzzyMatches: number;
};

export type DedupeResult = {
  papers: UnifiedPaper[];
  stats: DedupeStats;
  debugRecords: UnifiedPaperDebugRecord[];
};

export const TITLE_FUZZY_SIMILARITY_THRESHOLD = 0.88;

const PROVIDER_PRIORITY: LiteratureProviderId[] = [
  "openalex",
  "arxiv",
  "pubmed",
  "crossref",
  "dblp",
  "openreview",
  "semantic_scholar",
];

export function buildExternalKey(
  provider: LiteratureProviderId,
  providerPaperId: string,
): string {
  switch (provider) {
    case "arxiv":
      return providerPaperId;
    case "pubmed":
      return providerPaperId.startsWith("pubmed:")
        ? providerPaperId
        : `pubmed:${providerPaperId}`;
    case "openalex":
      return providerPaperId.startsWith("openalex:")
        ? providerPaperId
        : `openalex:${providerPaperId}`;
    case "crossref": {
      const doi =
        normalizeDoi(providerPaperId) ??
        providerPaperId.replace(/^crossref:/i, "");
      return `crossref:${doi}`;
    }
    case "dblp": {
      const dblpKey = providerPaperId.replace(/^dblp:/i, "");
      return `dblp:${dblpKey}`;
    }
    default:
      return `${provider}:${providerPaperId}`;
  }
}

export function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/^https?:\/\/doi\.org\//i, "").trim().toLowerCase() || null;
}

export function normalizeArxivId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
    .replace(/^arxiv:/i, "")
    .trim()
    .toLowerCase();

  return cleaned.replace(/v\d+$/i, "") || null;
}

export function normalizePubmedId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/^pubmed:/i, "").replace(/\D/g, "");
  return digits || null;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function titleTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

export function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isPdfUrl(url: string): boolean {
  return /\.pdf($|\?)/i.test(url) || /\/pdf\//i.test(url);
}

function pickBestTitle(left: string, right: string): string {
  if (!left.trim()) {
    return right;
  }

  if (!right.trim()) {
    return left;
  }

  const leftNormalized = normalizeTitle(left);
  const rightNormalized = normalizeTitle(right);

  if (leftNormalized === rightNormalized) {
    return left.length >= right.length ? left : right;
  }

  if (
    leftNormalized.includes(rightNormalized) ||
    rightNormalized.includes(leftNormalized)
  ) {
    return left.length >= right.length ? left : right;
  }

  return left.length >= right.length ? left : right;
}

function mergeAuthors(left: string[], right: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const name of [...left, ...right]) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(trimmed);
  }

  return merged;
}

function pickEarliestPublishedAt(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isNaN(leftTime)) {
    return right;
  }

  if (Number.isNaN(rightTime)) {
    return left;
  }

  return leftTime <= rightTime ? left : right;
}

function pickPdfUrl(left: string, right: string): string {
  if (isPdfUrl(left)) {
    return left;
  }

  if (isPdfUrl(right)) {
    return right;
  }

  return left || right;
}

function pickPrimaryAbsUrl(left: string, right: string): string {
  return left || right;
}

function mergeProviderList(
  left: LiteratureProviderId[],
  right: LiteratureProviderId[],
): LiteratureProviderId[] {
  const combined = new Set<LiteratureProviderId>([...left, ...right]);
  return PROVIDER_PRIORITY.filter((provider) => combined.has(provider));
}

function mergeSourceUrls(
  left: Partial<Record<LiteratureProviderId, string>>,
  right: Partial<Record<LiteratureProviderId, string>>,
): Partial<Record<LiteratureProviderId, string>> {
  return {
    ...left,
    ...right,
  };
}

function pickExternalKey(existing: UnifiedPaper, incoming: UnifiedPaper): string {
  if (existing.arxivId) {
    return buildExternalKey("arxiv", existing.arxivId);
  }

  if (incoming.arxivId) {
    return buildExternalKey("arxiv", incoming.arxivId);
  }

  if (existing.pubmedId) {
    return buildExternalKey("pubmed", existing.pubmedId);
  }

  if (incoming.pubmedId) {
    return buildExternalKey("pubmed", incoming.pubmedId);
  }

  if (existing.openAlexId) {
    return buildExternalKey("openalex", existing.openAlexId);
  }

  if (incoming.openAlexId) {
    return buildExternalKey("openalex", incoming.openAlexId);
  }

  if (existing.doi) {
    return buildExternalKey("crossref", existing.doi);
  }

  if (incoming.doi) {
    return buildExternalKey("crossref", incoming.doi);
  }

  return existing.externalKey || incoming.externalKey;
}

function pickPrimaryProvider(
  providers: LiteratureProviderId[],
): LiteratureProviderId {
  return (
    PROVIDER_PRIORITY.find((provider) => providers.includes(provider)) ??
    providers[0] ??
    "openalex"
  );
}

function withProviderDefaults(paper: UnifiedPaper): UnifiedPaper {
  const providers =
    paper.providers.length > 0 ? paper.providers : [paper.provider];
  const sourceUrls =
    Object.keys(paper.sourceUrls).length > 0
      ? paper.sourceUrls
      : { [paper.provider]: paper.absUrl };

  return {
    ...paper,
    doi: normalizeDoi(paper.doi),
    arxivId: normalizeArxivId(paper.arxivId),
    pubmedId: normalizePubmedId(paper.pubmedId),
    providers,
    sourceUrls,
  };
}

function exactDedupKeys(paper: UnifiedPaper): string[] {
  const keys = new Set<string>();

  if (paper.doi) {
    keys.add(`doi:${paper.doi}`);
  }

  if (paper.arxivId) {
    keys.add(`arxiv:${paper.arxivId}`);
  }

  if (paper.pubmedId) {
    keys.add(`pmid:${paper.pubmedId}`);
  }

  const normalizedTitle = normalizeTitle(paper.title);
  if (normalizedTitle) {
    keys.add(`title:${normalizedTitle}`);
  }

  return [...keys];
}

function mergeUnifiedPapers(
  existing: UnifiedPaper,
  incoming: UnifiedPaper,
): UnifiedPaper {
  const left = withProviderDefaults(existing);
  const right = withProviderDefaults(incoming);
  const providers = mergeProviderList(left.providers, right.providers);
  const primaryProvider = pickPrimaryProvider(providers);
  const sourceUrls = mergeSourceUrls(left.sourceUrls, right.sourceUrls);
  const preferIncomingAbstract =
    right.abstract.trim().length > left.abstract.trim().length;

  const mergedCategories =
    left.categories.length >= right.categories.length
      ? left.categories
      : right.categories;

  return {
    provider: primaryProvider,
    providerPaperId:
      primaryProvider === left.provider
        ? left.providerPaperId
        : right.providerPaperId,
    externalKey: pickExternalKey(left, right),
    title: pickBestTitle(left.title, right.title),
    abstract: preferIncomingAbstract ? right.abstract : left.abstract,
    authors: mergeAuthors(left.authors, right.authors),
    publishedAt: pickEarliestPublishedAt(left.publishedAt, right.publishedAt),
    pdfUrl: pickPdfUrl(left.pdfUrl, right.pdfUrl),
    absUrl: pickPrimaryAbsUrl(left.absUrl, right.absUrl),
    categories: mergedCategories,
    doi: left.doi ?? right.doi,
    arxivId: left.arxivId ?? right.arxivId,
    pubmedId: left.pubmedId ?? right.pubmedId,
    openAlexId: left.openAlexId ?? right.openAlexId,
    citationCount: left.citationCount ?? right.citationCount,
    providers,
    sourceUrls,
  };
}

function findExactMatchIndex(
  paper: UnifiedPaper,
  keyToIndex: Map<string, number>,
): { index: number; reason: Exclude<LiteratureDedupeMatchReason, "new" | "fuzzy_title"> } | undefined {
  if (paper.doi) {
    const index = keyToIndex.get(`doi:${paper.doi}`);
    if (index !== undefined) {
      return { index, reason: "doi" };
    }
  }

  if (paper.pubmedId) {
    const index = keyToIndex.get(`pmid:${paper.pubmedId}`);
    if (index !== undefined) {
      return { index, reason: "pmid" };
    }
  }

  if (paper.arxivId) {
    const index = keyToIndex.get(`arxiv:${paper.arxivId}`);
    if (index !== undefined) {
      return { index, reason: "arxiv" };
    }
  }

  const normalizedTitle = normalizeTitle(paper.title);
  if (normalizedTitle) {
    const index = keyToIndex.get(`title:${normalizedTitle}`);
    if (index !== undefined) {
      return { index, reason: "title" };
    }
  }

  return undefined;
}

function findFuzzyMatchIndex(
  paper: UnifiedPaper,
  merged: UnifiedPaper[],
): number | undefined {
  for (let index = 0; index < merged.length; index += 1) {
    const candidate = merged[index]!;

    if (
      titleSimilarity(paper.title, candidate.title) >=
      TITLE_FUZZY_SIMILARITY_THRESHOLD
    ) {
      return index;
    }
  }

  return undefined;
}

export function deduplicateUnifiedPapers(papers: UnifiedPaper[]): DedupeResult {
  const keyToIndex = new Map<string, number>();
  const merged: UnifiedPaper[] = [];
  const debugRecords: UnifiedPaperDebugRecord[] = [];
  let exactMatches = 0;
  let fuzzyMatches = 0;

  for (const rawPaper of papers) {
    const paper = withProviderDefaults(rawPaper);
    let existingIndex: number | undefined;
    let matchReason: LiteratureDedupeMatchReason = "new";

    const exactMatch = findExactMatchIndex(paper, keyToIndex);
    if (exactMatch !== undefined) {
      existingIndex = exactMatch.index;
      matchReason = exactMatch.reason;
      exactMatches += 1;
    }

    if (existingIndex === undefined) {
      existingIndex = findFuzzyMatchIndex(paper, merged);
      if (existingIndex !== undefined) {
        matchReason = "fuzzy_title";
        fuzzyMatches += 1;
      }
    }

    if (existingIndex === undefined) {
      const index = merged.length;
      merged.push(paper);
      debugRecords.push({
        matchedBy: "new",
        mergeSourceCount: 1,
      });

      for (const key of exactDedupKeys(paper)) {
        keyToIndex.set(key, index);
      }

      continue;
    }

    merged[existingIndex] = mergeUnifiedPapers(merged[existingIndex]!, paper);
    const mergedPaper = withProviderDefaults(merged[existingIndex]!);
    debugRecords[existingIndex] = {
      matchedBy: matchReason,
      mergeSourceCount: debugRecords[existingIndex]!.mergeSourceCount + 1,
    };

    for (const key of exactDedupKeys(mergedPaper)) {
      keyToIndex.set(key, existingIndex);
    }
  }

  const inputCount = papers.length;
  const outputCount = merged.length;

  return {
    papers: merged,
    stats: {
      inputCount,
      outputCount,
      duplicatesRemoved: Math.max(0, inputCount - outputCount),
      exactMatches,
      fuzzyMatches,
    },
    debugRecords,
  };
}

export function unifiedPaperToDraft(
  paper: UnifiedPaper,
): ArxivPaperDraft & { citationCount?: number | null } {
  const normalized = withProviderDefaults(paper);
  const categories = [...normalized.categories];

  if (
    normalized.doi &&
    !categories.some((item) => item.toLowerCase().startsWith("doi:"))
  ) {
    categories.unshift(`doi:${normalized.doi}`);
  }

  return {
    arxivId: normalized.externalKey,
    title: normalized.title,
    abstract: normalized.abstract,
    authors: normalized.authors,
    publishedAt: normalized.publishedAt,
    pdfUrl: normalized.pdfUrl,
    absUrl: normalized.absUrl,
    categories,
    citationCount: normalized.citationCount,
    providers: normalized.providers,
    sourceUrls: normalized.sourceUrls,
  };
}

export function matchesExcludeKeywords(
  paper: UnifiedPaper,
  excludeKeywords: string,
): boolean {
  const terms = excludeKeywords
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);

  if (terms.length === 0) {
    return false;
  }

  const haystack = `${paper.title} ${paper.abstract}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}
