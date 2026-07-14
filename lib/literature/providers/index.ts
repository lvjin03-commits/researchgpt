// Server-only module.

import { LITERATURE_MAX_ARXIV_RESULTS } from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import { applyDraftProviderMetadata } from "@/lib/literature/paper-providers";
import { rankLiteraturePapers } from "@/lib/literature/ranking/ranking";
import { matchesLiteratureKeywords } from "@/lib/literature/search-keywords";
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
import { dblpProvider } from "@/lib/literature/providers/dblp";
import { openReviewProvider } from "@/lib/literature/providers/openreview";
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
  dblpProvider,
  openReviewProvider,
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
  afterKeywordMatch: number;
  finalCount: number;
};

const LITERATURE_QUALITY_SCORE_FLOOR = 20;
const MIN_PAPERS_BEFORE_APPLYING_QUALITY_FLOOR = 10;

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function toSearchOptions(settings: LiteratureSettings): ProviderSearchOptions {
  return {
    keywords: settings.keywords,
    researchDirection: settings.researchDirection,
    excludeKeywords: settings.excludeKeywords,
    dateRangeDays: settings.dateRangeDays,
    maxResults: LITERATURE_MAX_ARXIV_RESULTS,
  };
}

function logSearchQualityMetrics(metrics: LiteratureSearchQualityMetrics): void {
  console.log(
    `[literature] search quality: fetched googleScholar=${metrics.fetchedByProvider.google_scholar ?? 0} openalex=${metrics.fetchedByProvider.openalex ?? 0} arxiv=${metrics.fetchedByProvider.arxiv ?? 0} pubmed=${metrics.fetchedByProvider.pubmed ?? 0} crossref=${metrics.fetchedByProvider.crossref ?? 0} dblp=${metrics.fetchedByProvider.dblp ?? 0} openreview=${metrics.fetchedByProvider.openreview ?? 0} totalFetched=${metrics.fetchedTotal}`,
  );
  console.log(
    `[literature] search quality: merged=${metrics.mergedTotal} duplicatesRemoved=${metrics.duplicatesRemoved} exactMatches=${metrics.exactMatches} fuzzyMatches=${metrics.fuzzyMatches} afterExclude=${metrics.afterExcludeKeywords} afterKeywordMatch=${metrics.afterKeywordMatch} final=${metrics.finalCount}`,
  );
}

function getEnabledProvidersForSettings(
  settings: LiteratureSettings,
): LiteratureProvider[] {
  const selected = new Set(settings.selectedSources);
  const selectedProviders = ACTIVE_LITERATURE_PROVIDERS.filter(
    (provider) => provider.enabled && selected.has(provider.id),
  );

  return selectedProviders.length > 0
    ? selectedProviders
    : ACTIVE_LITERATURE_PROVIDERS.filter((provider) => provider.enabled);
}

type FetchFromProviderResult = {
  papers: UnifiedPaper[];
  failed: boolean;
};

async function fetchFromProvider(
  provider: LiteratureProvider,
  options: ProviderSearchOptions,
): Promise<FetchFromProviderResult> {
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

    return { papers: normalized, failed: false };
  } catch (error) {
    if (error instanceof LiteratureError && error.statusCode === 404) {
      console.log(
        `[literature] step fetch ${provider.id}: done elapsedMs=${elapsedMs(startedAt)} papers=0 (no matches)`,
      );
      return { papers: [], failed: false };
    }

    const reason = error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[literature] step fetch ${provider.id}: failed elapsedMs=${elapsedMs(startedAt)} reason=${reason}`,
      error,
    );
    return { papers: [], failed: true };
  }
}

const PARTIAL_PROVIDER_FAILURE_WARNING =
  "部分数据源暂时不可用，已使用其他来源完成搜索。";

export async function searchLiteratureProviders(
  settings: LiteratureSettings,
): Promise<{
  drafts: ArxivPaperDraft[];
  quality: LiteratureSearchQualityMetrics;
  dedupeStats: DedupeStats;
  failedProviders: LiteratureProviderId[];
  warnings: string[];
  debug?: LiteratureSearchDebug;
}> {
  const options = toSearchOptions(settings);
  const allUnified: UnifiedPaper[] = [];
  const fetchedByProvider: Partial<Record<LiteratureProviderId, number>> = {};
  const failedProviders: LiteratureProviderId[] = [];
  const enabledProviders = getEnabledProvidersForSettings(settings);

  const providerResults = await Promise.all(
    enabledProviders.map(async (provider) => ({
      provider,
      result: await fetchFromProvider(provider, options),
    })),
  );

  for (const { provider, result } of providerResults) {
    const { papers, failed } = result;

    if (failed) {
      failedProviders.push(provider.id);
      continue;
    }

    fetchedByProvider[provider.id] = papers.length;
    allUnified.push(...papers);
  }

  if (
    enabledProviders.length > 0 &&
    failedProviders.length === enabledProviders.length
  ) {
    throw new LiteratureError("所有数据源暂时不可用，请稍后重试。", 502);
  }

  console.log("[literature] step merge results: start");
  const mergeStartedAt = Date.now();

  console.log("[literature] step deduplicate: start");
  const dedupeStartedAt = Date.now();

  const { papers: deduped, stats: dedupeStats, debugRecords } =
    deduplicateUnifiedPapers(allUnified);
  const afterExcludePairs = deduped
    .map((paper, index) => ({
      paper,
      debug: debugRecords[index]!,
    }))
    .filter(({ paper }) => !matchesExcludeKeywords(paper, options.excludeKeywords));
  const keywordMatchedPairs = afterExcludePairs.filter(
    ({ paper }) =>
      paper.abstract.trim().length > 0 &&
      matchesLiteratureKeywords(paper.title, paper.abstract, settings.keywords),
  );
  const drafts = keywordMatchedPairs
    .map(({ paper }) => paper)
    .map(unifiedPaperToDraft)
    .map(applyDraftProviderMetadata);

  console.log("[literature] step rank papers: start");
  const rankStartedAt = Date.now();
  const { papers: rankedDrafts, breakdownByArxivId } = rankLiteraturePapers(
    drafts,
    settings,
  );
  const rankingByArxivId = new Map(
    rankedDrafts.map((paper) => [paper.arxivId, paper.rankingScore ?? 0]),
  );
  const rankingBreakdownByArxivId = breakdownByArxivId;
  const qualityFilteredDrafts =
    rankedDrafts.length >= MIN_PAPERS_BEFORE_APPLYING_QUALITY_FLOOR
      ? rankedDrafts.filter(
          (paper) =>
            (paper.rankingScore ?? 0) >= LITERATURE_QUALITY_SCORE_FLOOR,
        )
      : rankedDrafts;
  const finalDrafts =
    qualityFilteredDrafts.length > 0 ? qualityFilteredDrafts : rankedDrafts;
  const finalPaperIds = new Set(finalDrafts.map((paper) => paper.arxivId));
  const debugPairs = keywordMatchedPairs.filter(({ paper }) =>
    finalPaperIds.has(paper.externalKey),
  );

  console.log(
    `[literature] step rank papers: done elapsedMs=${elapsedMs(rankStartedAt)} papers=${rankedDrafts.length} qualityFiltered=${finalDrafts.length} topScore=${rankedDrafts[0]?.rankingScore ?? 0}`,
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
    afterExcludeKeywords: afterExcludePairs.length,
    afterKeywordMatch: keywordMatchedPairs.length,
    finalCount: finalDrafts.length,
  };

  logSearchQualityMetrics(quality);

  console.log(
    `[literature] step merge results: done elapsedMs=${elapsedMs(mergeStartedAt)} totalPapers=${finalDrafts.length}`,
  );

  if (finalDrafts.length === 0) {
    throw new LiteratureError(
      "未找到标题或摘要命中关键词的论文，请调整关键词或扩大时间范围。",
      404,
    );
  }

  const warnings =
    failedProviders.length > 0 ? [PARTIAL_PROVIDER_FAILURE_WARNING] : [];

  const debug = isLiteratureDebugEnabled()
    ? buildLiteratureSearchDebug(
        {
          googleScholar: quality.fetchedByProvider.google_scholar ?? 0,
          openalex: quality.fetchedByProvider.openalex ?? 0,
          arxiv: quality.fetchedByProvider.arxiv ?? 0,
          pubmed: quality.fetchedByProvider.pubmed ?? 0,
          crossref: quality.fetchedByProvider.crossref ?? 0,
          dblp: quality.fetchedByProvider.dblp ?? 0,
          openreview: quality.fetchedByProvider.openreview ?? 0,
          totalFetched: quality.fetchedTotal,
          duplicatesRemoved: quality.duplicatesRemoved,
          finalPapers: quality.finalCount,
        },
        debugPairs,
        rankingByArxivId,
        rankingBreakdownByArxivId,
        failedProviders,
      )
    : undefined;

  return {
    drafts: finalDrafts,
    quality,
    dedupeStats,
    failedProviders,
    warnings,
    debug,
  };
}
