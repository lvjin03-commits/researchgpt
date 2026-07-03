// Server-only module.

import { LITERATURE_MAX_ARXIV_RESULTS } from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import { applyDraftProviderMetadata } from "@/lib/literature/paper-providers";
import { rankLiteraturePapers } from "@/lib/literature/ranking/ranking";
import type { LiteratureSearchDebug } from "@/lib/literature/search-debug";
import { buildLiteratureSearchDebug } from "@/lib/literature/server/search-debug";
import { isLiteratureDebugEnabled } from "@/lib/literature/server/debug";
import {
  deduplicateUnifiedPapers,
  matchesExcludeKeywords,
  type DedupeStats,
  type LiteratureProvider,
  type LiteratureProviderId,
  type ProviderSearchOptions,
  type UnifiedPaper,
  unifiedPaperToDraft,
} from "@/lib/literature/providers/base";
import { arxivProvider } from "@/lib/literature/providers/arxiv";
import { crossrefProvider } from "@/lib/literature/providers/crossref";
import { openAlexProvider } from "@/lib/literature/providers/openalex";
import { pubmedProvider } from "@/lib/literature/providers/pubmed";
import { FUTURE_LITERATURE_PROVIDERS } from "@/lib/literature/providers/placeholders";
import type { ArxivPaperDraft, LiteratureSettings } from "@/lib/literature/types";

/** Default source ids stored with settings for backward compatibility. */
export { DEFAULT_LITERATURE_PIPELINE_SOURCES } from "@/lib/literature/constants";

/** Providers used by the literature search pipeline, in priority order. */
export const ACTIVE_LITERATURE_PROVIDERS: LiteratureProvider[] = [
  openAlexProvider,
  arxivProvider,
  pubmedProvider,
  crossrefProvider,
];

/** Placeholder provider ids reserved for future integration. */
export const FUTURE_LITERATURE_PROVIDER_IDS = FUTURE_LITERATURE_PROVIDERS.map(
  (provider) => provider.id,
) as LiteratureProviderId[];

export type LiteratureSearchQualityMetrics = {
  fetchedByProvider: Partial<Record<LiteratureProviderId, number>>;
  fetchedTotal: number;
  mergedTotal: number;
  duplicatesRemoved: number;
  exactMatches: number;
  fuzzyMatches: number;
  afterExcludeKeywords: number;
  finalCount: number;
};

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function toSearchOptions(settings: LiteratureSettings): ProviderSearchOptions {
  return {
    keywords: settings.keywords,
    excludeKeywords: settings.excludeKeywords,
    dateRangeDays: settings.dateRangeDays,
    maxResults: LITERATURE_MAX_ARXIV_RESULTS,
  };
}

function logSearchQualityMetrics(metrics: LiteratureSearchQualityMetrics): void {
  console.log(
    `[literature] search quality: fetched openalex=${metrics.fetchedByProvider.openalex ?? 0} arxiv=${metrics.fetchedByProvider.arxiv ?? 0} pubmed=${metrics.fetchedByProvider.pubmed ?? 0} crossref=${metrics.fetchedByProvider.crossref ?? 0} totalFetched=${metrics.fetchedTotal}`,
  );
  console.log(
    `[literature] search quality: merged=${metrics.mergedTotal} duplicatesRemoved=${metrics.duplicatesRemoved} exactMatches=${metrics.exactMatches} fuzzyMatches=${metrics.fuzzyMatches} afterExclude=${metrics.afterExcludeKeywords} final=${metrics.finalCount}`,
  );
}

async function fetchFromProvider(
  provider: LiteratureProvider,
  options: ProviderSearchOptions,
): Promise<UnifiedPaper[]> {
  console.log(`[literature] step fetch ${provider.id}: start`);
  const startedAt = Date.now();

  try {
    const rawResults = await provider.searchPapers(options);
    const normalized = rawResults
      .map((raw) => {
        try {
          return provider.normalizePaper(raw);
        } catch (error) {
          console.error(`[literature] ${provider.id} normalize failed:`, error);
          return null;
        }
      })
      .filter((paper): paper is UnifiedPaper => paper !== null);

    console.log(
      `[literature] step fetch ${provider.id}: done elapsedMs=${elapsedMs(startedAt)} papers=${normalized.length}`,
    );

    return normalized;
  } catch (error) {
    if (error instanceof LiteratureError && error.statusCode === 404) {
      console.log(
        `[literature] step fetch ${provider.id}: done elapsedMs=${elapsedMs(startedAt)} papers=0 (no matches)`,
      );
      return [];
    }

    throw error;
  }
}

export async function searchLiteratureProviders(
  settings: LiteratureSettings,
): Promise<{
  drafts: ArxivPaperDraft[];
  quality: LiteratureSearchQualityMetrics;
  dedupeStats: DedupeStats;
  debug?: LiteratureSearchDebug;
}> {
  const options = toSearchOptions(settings);
  const allUnified: UnifiedPaper[] = [];
  const fetchedByProvider: Partial<Record<LiteratureProviderId, number>> = {};

  for (const provider of ACTIVE_LITERATURE_PROVIDERS) {
    if (!provider.enabled) {
      console.log(`[literature] step fetch ${provider.id}: skipped (disabled)`);
      continue;
    }

    const papers = await fetchFromProvider(provider, options);
    fetchedByProvider[provider.id] = papers.length;
    allUnified.push(...papers);
  }

  console.log("[literature] step merge results: start");
  const mergeStartedAt = Date.now();

  console.log("[literature] step deduplicate: start");
  const dedupeStartedAt = Date.now();

  const { papers: deduped, stats: dedupeStats, debugRecords } =
    deduplicateUnifiedPapers(allUnified);
  const finalPairs = deduped
    .map((paper, index) => ({
      paper,
      debug: debugRecords[index]!,
    }))
    .filter(({ paper }) => !matchesExcludeKeywords(paper, options.excludeKeywords));
  const afterExclude = finalPairs.map(({ paper }) => paper);
  const drafts = afterExclude
    .map(unifiedPaperToDraft)
    .map(applyDraftProviderMetadata);

  console.log("[literature] step rank papers: start");
  const rankStartedAt = Date.now();
  const { papers: rankedDrafts } = rankLiteraturePapers(drafts, settings);
  const rankingByArxivId = new Map(
    rankedDrafts.map((paper) => [paper.arxivId, paper.rankingScore ?? 0]),
  );

  console.log(
    `[literature] step rank papers: done elapsedMs=${elapsedMs(rankStartedAt)} papers=${rankedDrafts.length} topScore=${rankedDrafts[0]?.rankingScore ?? 0}`,
  );

  console.log(
    `[literature] step deduplicate: done elapsedMs=${elapsedMs(dedupeStartedAt)} merged=${allUnified.length} unique=${deduped.length} duplicatesRemoved=${dedupeStats.duplicatesRemoved}`,
  );

  const quality: LiteratureSearchQualityMetrics = {
    fetchedByProvider,
    fetchedTotal: allUnified.length,
    mergedTotal: deduped.length,
    duplicatesRemoved: dedupeStats.duplicatesRemoved,
    exactMatches: dedupeStats.exactMatches,
    fuzzyMatches: dedupeStats.fuzzyMatches,
    afterExcludeKeywords: afterExclude.length,
    finalCount: rankedDrafts.length,
  };

  logSearchQualityMetrics(quality);

  console.log(
    `[literature] step merge results: done elapsedMs=${elapsedMs(mergeStartedAt)} totalPapers=${rankedDrafts.length}`,
  );

  if (rankedDrafts.length === 0) {
    throw new LiteratureError(
      "未找到符合关键词与时间范围的论文。",
      404,
    );
  }

  const debug = isLiteratureDebugEnabled()
    ? buildLiteratureSearchDebug(
        {
          openalex: quality.fetchedByProvider.openalex ?? 0,
          arxiv: quality.fetchedByProvider.arxiv ?? 0,
          pubmed: quality.fetchedByProvider.pubmed ?? 0,
          crossref: quality.fetchedByProvider.crossref ?? 0,
          totalFetched: quality.fetchedTotal,
          duplicatesRemoved: quality.duplicatesRemoved,
          finalPapers: quality.finalCount,
        },
        finalPairs,
        rankingByArxivId,
      )
    : undefined;

  return { drafts: rankedDrafts, quality, dedupeStats, debug };
}
