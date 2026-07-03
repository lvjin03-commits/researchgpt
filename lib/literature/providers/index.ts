// Server-only module.

import { LITERATURE_MAX_ARXIV_RESULTS } from "@/lib/literature/constants";
import { LiteratureError } from "@/lib/literature/errors";
import {
  deduplicateUnifiedPapers,
  matchesExcludeKeywords,
  type LiteratureProvider,
  type LiteratureProviderId,
  type ProviderSearchOptions,
  type UnifiedPaper,
  unifiedPaperToDraft,
} from "@/lib/literature/providers/base";
import { arxivProvider } from "@/lib/literature/providers/arxiv";
import { openAlexProvider } from "@/lib/literature/providers/openalex";
import { pubmedProvider } from "@/lib/literature/providers/pubmed";
import { FUTURE_LITERATURE_PROVIDERS } from "@/lib/literature/providers/placeholders";
import type { ArxivPaperDraft, LiteratureSettings } from "@/lib/literature/types";

/** Default source ids stored with settings for backward compatibility. */
export const DEFAULT_LITERATURE_PIPELINE_SOURCES = [
  "openalex",
  "arxiv",
  "pubmed",
] as const;

/** Providers used by the literature search pipeline, in priority order. */
export const ACTIVE_LITERATURE_PROVIDERS: LiteratureProvider[] = [
  openAlexProvider,
  arxivProvider,
  pubmedProvider,
];

/** Placeholder provider ids reserved for future integration. */
export const FUTURE_LITERATURE_PROVIDER_IDS = FUTURE_LITERATURE_PROVIDERS.map(
  (provider) => provider.id,
) as LiteratureProviderId[];

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
): Promise<ArxivPaperDraft[]> {
  const options = toSearchOptions(settings);
  const allUnified: UnifiedPaper[] = [];
  const providerCounts: Partial<Record<LiteratureProviderId, number>> = {};

  for (const provider of ACTIVE_LITERATURE_PROVIDERS) {
    if (!provider.enabled) {
      console.log(`[literature] step fetch ${provider.id}: skipped (disabled)`);
      continue;
    }

    const papers = await fetchFromProvider(provider, options);
    providerCounts[provider.id] = papers.length;
    allUnified.push(...papers);
  }

  console.log("[literature] step merge results: start");
  const mergeStartedAt = Date.now();

  console.log("[literature] step deduplicate: start");
  const dedupeStartedAt = Date.now();

  const deduped = deduplicateUnifiedPapers(allUnified).filter(
    (paper) => !matchesExcludeKeywords(paper, options.excludeKeywords),
  );
  const drafts = deduped.map(unifiedPaperToDraft);

  console.log(
    `[literature] step deduplicate: done elapsedMs=${elapsedMs(dedupeStartedAt)} merged=${allUnified.length} unique=${deduped.length}`,
  );

  console.log(
    `[literature] step merge results: done elapsedMs=${elapsedMs(mergeStartedAt)} openalex=${providerCounts.openalex ?? 0} arxiv=${providerCounts.arxiv ?? 0} pubmed=${providerCounts.pubmed ?? 0} totalPapers=${drafts.length}`,
  );

  if (drafts.length === 0) {
    throw new LiteratureError(
      "未找到符合关键词与时间范围的论文。",
      404,
    );
  }

  return drafts;
}
