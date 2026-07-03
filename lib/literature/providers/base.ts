// Server-only module.

import type { ArxivPaperDraft } from "@/lib/literature/types";

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
};

export interface LiteratureProvider {
  readonly id: LiteratureProviderId;
  readonly name: string;
  readonly enabled: boolean;
  searchPapers(options: ProviderSearchOptions): Promise<unknown[]>;
  getPaper(providerPaperId: string): Promise<unknown | null>;
  normalizePaper(raw: unknown): UnifiedPaper;
}

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
    default:
      return `${provider}:${providerPaperId}`;
  }
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function paperDedupKeys(paper: UnifiedPaper): string[] {
  const keys = new Set<string>();

  keys.add(paper.externalKey.toLowerCase());

  if (paper.doi) {
    keys.add(`doi:${paper.doi.toLowerCase()}`);
  }

  if (paper.arxivId) {
    keys.add(`arxiv:${paper.arxivId.toLowerCase()}`);
  }

  if (paper.pubmedId) {
    keys.add(`pubmed:${paper.pubmedId}`);
  }

  if (paper.openAlexId) {
    keys.add(`openalex:${paper.openAlexId.toLowerCase()}`);
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
  const preferIncomingAbstract =
    incoming.abstract.trim().length > existing.abstract.trim().length;

  return {
    ...existing,
    title: existing.title || incoming.title,
    abstract: preferIncomingAbstract ? incoming.abstract : existing.abstract,
    authors: existing.authors.length >= incoming.authors.length
      ? existing.authors
      : incoming.authors,
    publishedAt: existing.publishedAt ?? incoming.publishedAt,
    pdfUrl: existing.pdfUrl || incoming.pdfUrl,
    absUrl: existing.absUrl || incoming.absUrl,
    categories:
      existing.categories.length >= incoming.categories.length
        ? existing.categories
        : incoming.categories,
    doi: existing.doi ?? incoming.doi,
    arxivId: existing.arxivId ?? incoming.arxivId,
    pubmedId: existing.pubmedId ?? incoming.pubmedId,
    openAlexId: existing.openAlexId ?? incoming.openAlexId,
    citationCount: existing.citationCount ?? incoming.citationCount,
    externalKey: existing.externalKey,
    provider: existing.provider,
    providerPaperId: existing.providerPaperId,
  };
}

export function deduplicateUnifiedPapers(papers: UnifiedPaper[]): UnifiedPaper[] {
  const keyToIndex = new Map<string, number>();
  const merged: UnifiedPaper[] = [];

  for (const paper of papers) {
    const keys = paperDedupKeys(paper);
    let existingIndex: number | undefined;

    for (const key of keys) {
      const index = keyToIndex.get(key);
      if (index !== undefined) {
        existingIndex = index;
        break;
      }
    }

    if (existingIndex === undefined) {
      const index = merged.length;
      merged.push(paper);
      for (const key of keys) {
        keyToIndex.set(key, index);
      }
      continue;
    }

    merged[existingIndex] = mergeUnifiedPapers(merged[existingIndex]!, paper);
    for (const key of paperDedupKeys(merged[existingIndex]!)) {
      keyToIndex.set(key, existingIndex);
    }
  }

  return merged;
}

export function unifiedPaperToDraft(
  paper: UnifiedPaper,
): ArxivPaperDraft & { citationCount?: number | null } {
  const categories = [...paper.categories];

  if (paper.doi && !categories.some((item) => item.toLowerCase().startsWith("doi:"))) {
    categories.unshift(`doi:${paper.doi}`);
  }

  return {
    arxivId: paper.externalKey,
    title: paper.title,
    abstract: paper.abstract,
    authors: paper.authors,
    publishedAt: paper.publishedAt,
    pdfUrl: paper.pdfUrl,
    absUrl: paper.absUrl,
    categories,
    citationCount: paper.citationCount,
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
