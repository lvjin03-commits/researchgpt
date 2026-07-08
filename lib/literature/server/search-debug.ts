// Server-only module.

import type {
  LiteratureProviderId,
  UnifiedPaper,
} from "@/lib/literature/providers/base";
import type { LiteratureRankingBreakdown } from "@/lib/literature/ranking/score";
import type {
  LiteratureSearchDebug,
  LiteratureSearchDebugSummary,
  UnifiedPaperDebugRecord,
} from "@/lib/literature/search-debug";

export function buildLiteratureSearchDebug(
  summary: LiteratureSearchDebugSummary,
  finalPairs: Array<{
    paper: UnifiedPaper;
    debug: UnifiedPaperDebugRecord;
  }>,
  rankingByArxivId?: Map<string, number>,
  rankingBreakdownByArxivId?: Map<string, LiteratureRankingBreakdown>,
  failedProviders: LiteratureProviderId[] = [],
): LiteratureSearchDebug {
  return {
    summary,
    ...(failedProviders.length > 0 ? { failedProviders } : {}),
    papers: finalPairs.map(({ paper, debug }) => ({
      arxivId: paper.externalKey,
      title: paper.title,
      providers: paper.providers,
      matchedBy: debug.matchedBy,
      mergeSourceCount: debug.mergeSourceCount,
      rankingScore: rankingByArxivId?.get(paper.externalKey),
      rankingBreakdown: rankingBreakdownByArxivId?.get(paper.externalKey),
    })),
  };
}
