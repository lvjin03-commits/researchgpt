// Server-only module.

import { fetchArxivPapers } from "@/lib/literature/server/arxiv";
import { isSourceAvailable } from "@/lib/literature/source-taxonomy";
import type { ArxivPaperDraft, LiteratureSettings } from "@/lib/literature/types";

export async function fetchPapersFromSelectedSources(
  settings: LiteratureSettings,
): Promise<ArxivPaperDraft[]> {
  const drafts: ArxivPaperDraft[] = [];

  for (const sourceId of settings.selectedSources) {
    if (!isSourceAvailable(sourceId)) {
      continue;
    }

    if (sourceId === "arxiv") {
      const arxivPapers = await fetchArxivPapers({
        keywords: settings.keywords,
        excludeKeywords: settings.excludeKeywords,
        dateRangeDays: settings.dateRangeDays,
      });
      drafts.push(...arxivPapers);
    }
  }

  return drafts;
}
