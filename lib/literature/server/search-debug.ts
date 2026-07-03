// Server-only module.

import type { UnifiedPaper } from "@/lib/literature/providers/base";
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
): LiteratureSearchDebug {
  return {
    summary,
    papers: finalPairs.map(({ paper, debug }) => ({
      arxivId: paper.externalKey,
      title: paper.title,
      providers: paper.providers,
      matchedBy: debug.matchedBy,
      mergeSourceCount: debug.mergeSourceCount,
      rankingScore: rankingByArxivId?.get(paper.externalKey),
    })),
  };
}
