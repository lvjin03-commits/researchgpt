import type { ArxivPaperDraft } from "@/lib/literature/types";

export type LiteratureRankingInput = {
  title: string;
  abstract: string;
  publishedAt: string | null;
  citationCount: number | null | undefined;
  pdfUrl: string;
  keywords: string;
  dateRangeDays?: number;
};

export type LiteratureRankingBreakdown = {
  keywordMatch: number;
  titleMatch: number;
  abstractMatch: number;
  publishedDate: number;
  citationCount: number;
  openAccessBonus: number;
  rankingScore: number;
};

const RANKING_WEIGHTS = {
  keywordMatch: 0.2,
  titleMatch: 0.25,
  abstractMatch: 0.15,
  publishedDate: 0.15,
  citationCount: 0.15,
  openAccessBonus: 0.1,
} as const;

function parseKeywordTerms(keywords: string): string[] {
  return keywords
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
}

function termCoverageScore(text: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const haystack = text.toLowerCase();
  let matched = 0;

  for (const term of terms) {
    if (haystack.includes(term)) {
      matched += 1;
    }
  }

  return matched / terms.length;
}

function keywordUnionScore(
  title: string,
  abstract: string,
  terms: string[],
): number {
  if (terms.length === 0) {
    return 0;
  }

  let matched = 0;

  for (const term of terms) {
    const haystack = `${title} ${abstract}`.toLowerCase();
    if (haystack.includes(term)) {
      matched += 1;
    }
  }

  return matched / terms.length;
}

function publishedDateScore(
  publishedAt: string | null,
  dateRangeDays?: number,
): number {
  if (!publishedAt) {
    return 0.2;
  }

  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) {
    return 0.2;
  }

  const ageMs = Date.now() - timestamp;
  if (ageMs < 0) {
    return 1;
  }

  const windowDays =
    dateRangeDays && dateRangeDays > 0 ? dateRangeDays : 3650;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const normalized = 1 - ageMs / windowMs;

  return Math.max(0, Math.min(1, normalized));
}

function citationCountScore(citationCount: number | null | undefined): number {
  if (typeof citationCount !== "number" || !Number.isFinite(citationCount)) {
    return 0;
  }

  if (citationCount <= 0) {
    return 0;
  }

  return Math.min(1, Math.log10(citationCount + 1) / 4);
}

function isOpenAccessPdf(pdfUrl: string): boolean {
  const normalized = pdfUrl.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("arxiv.org/pdf/") ||
    normalized.includes("/pdf/") ||
    normalized.endsWith(".pdf") ||
    normalized.includes("pmc.ncbi.nlm.nih.gov") ||
    normalized.includes("biorxiv.org") ||
    normalized.includes("medrxiv.org")
  );
}

function openAccessBonusScore(pdfUrl: string): number {
  return isOpenAccessPdf(pdfUrl) ? 1 : 0;
}

function toRankingScore(breakdown: Omit<LiteratureRankingBreakdown, "rankingScore">): number {
  const weighted =
    breakdown.keywordMatch * RANKING_WEIGHTS.keywordMatch +
    breakdown.titleMatch * RANKING_WEIGHTS.titleMatch +
    breakdown.abstractMatch * RANKING_WEIGHTS.abstractMatch +
    breakdown.publishedDate * RANKING_WEIGHTS.publishedDate +
    breakdown.citationCount * RANKING_WEIGHTS.citationCount +
    breakdown.openAccessBonus * RANKING_WEIGHTS.openAccessBonus;

  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
}

export function computeLiteratureRankingBreakdown(
  input: LiteratureRankingInput,
): LiteratureRankingBreakdown {
  const terms = parseKeywordTerms(input.keywords);

  const partial = {
    keywordMatch: keywordUnionScore(input.title, input.abstract, terms),
    titleMatch: termCoverageScore(input.title, terms),
    abstractMatch: termCoverageScore(input.abstract, terms),
    publishedDate: publishedDateScore(input.publishedAt, input.dateRangeDays),
    citationCount: citationCountScore(input.citationCount),
    openAccessBonus: openAccessBonusScore(input.pdfUrl),
  };

  return {
    ...partial,
    rankingScore: toRankingScore(partial),
  };
}

export function draftToRankingInput(
  draft: ArxivPaperDraft,
  keywords: string,
  dateRangeDays?: number,
): LiteratureRankingInput {
  return {
    title: draft.title,
    abstract: draft.abstract,
    publishedAt: draft.publishedAt,
    citationCount: draft.citationCount,
    pdfUrl: draft.pdfUrl,
    keywords,
    dateRangeDays,
  };
}
