// Server-only module.

import { fetchArxivPapers } from "@/lib/literature/server/arxiv";
import { LiteratureError } from "@/lib/literature/errors";
import { fetchPubMedPapers } from "@/lib/literature/providers/pubmed";
import { isSourceAvailable } from "@/lib/literature/source-taxonomy";
import type { ArxivPaperDraft, LiteratureSettings } from "@/lib/literature/types";

export async function fetchPapersFromSelectedSources(
  settings: LiteratureSettings,
): Promise<ArxivPaperDraft[]> {
  const drafts: ArxivPaperDraft[] = [];
  const emptySourceErrors: LiteratureError[] = [];

  for (const sourceId of settings.selectedSources) {
    if (!isSourceAvailable(sourceId)) {
      continue;
    }

    try {
      if (sourceId === "arxiv") {
        const arxivPapers = await fetchArxivPapers({
          keywords: settings.keywords,
          excludeKeywords: settings.excludeKeywords,
          dateRangeDays: settings.dateRangeDays,
        });
        drafts.push(...arxivPapers);
        continue;
      }

      if (sourceId === "pubmed") {
        const pubmedPapers = await fetchPubMedPapers({
          keywords: settings.keywords,
          excludeKeywords: settings.excludeKeywords,
          dateRangeDays: settings.dateRangeDays,
        });
        drafts.push(...pubmedPapers);
      }
    } catch (error) {
      if (error instanceof LiteratureError && error.statusCode === 404) {
        emptySourceErrors.push(error);
        continue;
      }

      throw error;
    }
  }

  if (drafts.length === 0) {
    throw (
      emptySourceErrors[0] ??
      new LiteratureError(
        "No papers matched your keywords in the selected date range.",
        404,
      )
    );
  }

  return drafts;
}
