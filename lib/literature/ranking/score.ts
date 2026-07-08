import type { LiteratureProviderId } from "@/lib/literature/providers/base";
import type { ArxivPaperDraft } from "@/lib/literature/types";

export type LiteratureRankingInput = {
  title: string;
  abstract: string;
  publishedAt: string | null;
  citationCount: number | null | undefined;
  pdfUrl: string;
  categories: string[];
  providers: LiteratureProviderId[];
  keywords: string;
  researchDirection: string;
  dateRangeDays?: number;
};

export type LiteratureRankingBreakdown = {
  keywordMatch: number;
  titleMatch: number;
  abstractMatch: number;
  researchDirectionMatch: number;
  phraseMatch: number;
  publishedDate: number;
  citationCount: number;
  openAccessBonus: number;
  providerReliability: number;
  metadataCompleteness: number;
  publicationQuality: number;
  rankingScore: number;
};

const RANKING_WEIGHTS = {
  keywordMatch: 0.12,
  titleMatch: 0.18,
  abstractMatch: 0.1,
  researchDirectionMatch: 0.18,
  phraseMatch: 0.1,
  publishedDate: 0.08,
  citationCount: 0.08,
  openAccessBonus: 0.04,
  providerReliability: 0.05,
  metadataCompleteness: 0.04,
  publicationQuality: 0.03,
} as const;

const LOW_VALUE_PUBLICATION_TYPES = [
  "correction",
  "erratum",
  "editorial",
  "letter",
  "comment",
  "news",
  "book-chapter",
  "book chapter",
  "posted-content",
  "dataset",
  "peer-review",
] as const;

const HIGH_VALUE_PUBLICATION_TYPES = [
  "journal-article",
  "journal article",
  "research article",
  "review",
  "systematic review",
  "meta-analysis",
  "preprint",
  "proceedings-article",
  "conference paper",
] as const;

const PROVIDER_RELIABILITY: Record<LiteratureProviderId, number> = {
  openalex: 0.9,
  pubmed: 0.95,
  arxiv: 0.82,
  semantic_scholar: 0.88,
  crossref: 0.62,
  dblp: 0.78,
  openreview: 0.76,
};

const DOI_PATTERN = /^doi:/i;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCommaTerms(value: string): string[] {
  return value
    .split(",")
    .map((term) => normalizeText(term))
    .filter(Boolean);
}

function parseSearchTerms(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  const phrases = parseCommaTerms(value);
  const tokens = normalized
    .split(/\s+/)
    .filter((term) => term.length > 2);

  return [...new Set([...phrases, ...tokens])];
}

function termCoverageScore(text: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const haystack = normalizeText(text);
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
  return termCoverageScore(`${title} ${abstract}`, terms);
}

function phraseMatchScore(title: string, abstract: string, keywords: string): number {
  const phrases = parseCommaTerms(keywords).filter((term) => term.includes(" "));
  if (phrases.length === 0) {
    return 0;
  }

  const titleScore = termCoverageScore(title, phrases);
  const fullTextScore = termCoverageScore(`${title} ${abstract}`, phrases);
  return clamp01(titleScore * 0.7 + fullTextScore * 0.3);
}

function researchDirectionScore(
  title: string,
  abstract: string,
  researchDirection: string,
): number {
  const terms = parseSearchTerms(researchDirection);
  if (terms.length === 0) {
    return 0;
  }

  const titleScore = termCoverageScore(title, terms);
  const abstractScore = termCoverageScore(abstract, terms);
  return clamp01(titleScore * 0.6 + abstractScore * 0.4);
}

function publishedDateScore(
  publishedAt: string | null,
  dateRangeDays?: number,
): number {
  if (!publishedAt) {
    return 0.15;
  }

  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) {
    return 0.15;
  }

  const ageMs = Date.now() - timestamp;
  if (ageMs < 0) {
    return 1;
  }

  const windowDays =
    dateRangeDays && dateRangeDays > 0 ? dateRangeDays : 3650;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const normalized = 1 - ageMs / windowMs;

  return clamp01(normalized);
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

function providerReliabilityScore(providers: LiteratureProviderId[]): number {
  if (providers.length === 0) {
    return 0.35;
  }

  const strongest = Math.max(
    ...providers.map((provider) => PROVIDER_RELIABILITY[provider] ?? 0.5),
  );
  const multiSourceBonus = Math.min(0.12, Math.max(0, providers.length - 1) * 0.04);

  return clamp01(strongest + multiSourceBonus);
}

function metadataCompletenessScore(input: LiteratureRankingInput): number {
  const hasDoi = input.categories.some((category) => DOI_PATTERN.test(category));
  const hasVenue = input.categories.some(
    (category) =>
      !DOI_PATTERN.test(category) &&
      category.trim().length > 3 &&
      !category.includes("{") &&
      !category.includes(":"),
  );
  const hasAbstract = input.abstract.trim().length >= 120;
  const hasDate = Boolean(input.publishedAt);
  const hasCitation = typeof input.citationCount === "number";
  const hasPdf = isOpenAccessPdf(input.pdfUrl);

  const signals = [hasDoi, hasVenue, hasAbstract, hasDate, hasCitation, hasPdf];
  const matched = signals.filter(Boolean).length;

  return matched / signals.length;
}

function publicationQualityScore(input: LiteratureRankingInput): number {
  const normalizedCategories = input.categories.map(normalizeText);

  if (
    normalizedCategories.some((category) =>
      LOW_VALUE_PUBLICATION_TYPES.some((type) => category.includes(type)),
    )
  ) {
    return 0.05;
  }

  if (!input.title.trim() || input.title.trim().length < 20) {
    return 0.15;
  }

  if (!input.abstract.trim()) {
    return 0.35;
  }

  if (
    normalizedCategories.some((category) =>
      HIGH_VALUE_PUBLICATION_TYPES.some((type) => category.includes(type)),
    )
  ) {
    return 1;
  }

  return 0.75;
}

function toRankingScore(
  breakdown: Omit<LiteratureRankingBreakdown, "rankingScore">,
): number {
  const weighted =
    breakdown.keywordMatch * RANKING_WEIGHTS.keywordMatch +
    breakdown.titleMatch * RANKING_WEIGHTS.titleMatch +
    breakdown.abstractMatch * RANKING_WEIGHTS.abstractMatch +
    breakdown.researchDirectionMatch *
      RANKING_WEIGHTS.researchDirectionMatch +
    breakdown.phraseMatch * RANKING_WEIGHTS.phraseMatch +
    breakdown.publishedDate * RANKING_WEIGHTS.publishedDate +
    breakdown.citationCount * RANKING_WEIGHTS.citationCount +
    breakdown.openAccessBonus * RANKING_WEIGHTS.openAccessBonus +
    breakdown.providerReliability * RANKING_WEIGHTS.providerReliability +
    breakdown.metadataCompleteness *
      RANKING_WEIGHTS.metadataCompleteness +
    breakdown.publicationQuality * RANKING_WEIGHTS.publicationQuality;

  return Math.max(0, Math.min(100, Math.round(weighted * 100)));
}

export function computeLiteratureRankingBreakdown(
  input: LiteratureRankingInput,
): LiteratureRankingBreakdown {
  const keywordTerms = parseCommaTerms(input.keywords);
  const partial = {
    keywordMatch: keywordUnionScore(input.title, input.abstract, keywordTerms),
    titleMatch: termCoverageScore(input.title, keywordTerms),
    abstractMatch: termCoverageScore(input.abstract, keywordTerms),
    researchDirectionMatch: researchDirectionScore(
      input.title,
      input.abstract,
      input.researchDirection,
    ),
    phraseMatch: phraseMatchScore(input.title, input.abstract, input.keywords),
    publishedDate: publishedDateScore(input.publishedAt, input.dateRangeDays),
    citationCount: citationCountScore(input.citationCount),
    openAccessBonus: openAccessBonusScore(input.pdfUrl),
    providerReliability: providerReliabilityScore(input.providers),
    metadataCompleteness: metadataCompletenessScore(input),
    publicationQuality: publicationQualityScore(input),
  };

  return {
    ...partial,
    rankingScore: toRankingScore(partial),
  };
}

export function draftToRankingInput(
  draft: ArxivPaperDraft,
  settings: Pick<
    import("@/lib/literature/types").LiteratureSettings,
    "keywords" | "researchDirection" | "dateRangeDays"
  >,
): LiteratureRankingInput {
  return {
    title: draft.title,
    abstract: draft.abstract,
    publishedAt: draft.publishedAt,
    citationCount: draft.citationCount,
    pdfUrl: draft.pdfUrl,
    categories: draft.categories,
    providers: draft.providers ?? [],
    keywords: settings.keywords,
    researchDirection: settings.researchDirection,
    dateRangeDays: settings.dateRangeDays,
  };
}
