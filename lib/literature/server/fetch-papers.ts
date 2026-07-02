// Server-only module.

import { fetchArxivPapers } from "@/lib/literature/server/arxiv";
import { LiteratureError } from "@/lib/literature/errors";
import { fetchPubMedPapers } from "@/lib/literature/providers/pubmed";
import { isSourceAvailable } from "@/lib/literature/source-taxonomy";
import type { ArxivPaperDraft, LiteratureSettings } from "@/lib/literature/types";

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export async function fetchPapersFromSelectedSources(
  settings: LiteratureSettings,
): Promise<ArxivPaperDraft[]> {
  const drafts: ArxivPaperDraft[] = [];
  const emptySourceErrors: LiteratureError[] = [];
  let arxivPaperCount = 0;
  let pubmedPaperCount = 0;
  let arxivStepLogged = false;
  let pubmedStepLogged = false;

  for (const sourceId of settings.selectedSources) {
    if (!isSourceAvailable(sourceId)) {
      continue;
    }

    if (sourceId === "arxiv") {
      arxivStepLogged = true;
      console.log("[literature] step fetch arxiv: start");
      const fetchArxivStartedAt = Date.now();

      try {
        const arxivPapers = await fetchArxivPapers({
          keywords: settings.keywords,
          excludeKeywords: settings.excludeKeywords,
          dateRangeDays: settings.dateRangeDays,
        });
        arxivPaperCount = arxivPapers.length;
        drafts.push(...arxivPapers);
        console.log(
          `[literature] step fetch arxiv: done elapsedMs=${elapsedMs(fetchArxivStartedAt)} papers=${arxivPaperCount}`,
        );
      } catch (error) {
        if (error instanceof LiteratureError && error.statusCode === 404) {
          console.log(
            `[literature] step fetch arxiv: done elapsedMs=${elapsedMs(fetchArxivStartedAt)} papers=0 (no matches)`,
          );
          emptySourceErrors.push(error);
          continue;
        }

        throw error;
      }

      continue;
    }

    if (sourceId === "pubmed") {
      pubmedStepLogged = true;
      console.log("[literature] step fetch pubmed: start");
      const fetchPubmedStartedAt = Date.now();

      try {
        const pubmedPapers = await fetchPubMedPapers({
          keywords: settings.keywords,
          excludeKeywords: settings.excludeKeywords,
          dateRangeDays: settings.dateRangeDays,
        });
        pubmedPaperCount = pubmedPapers.length;
        drafts.push(...pubmedPapers);
        console.log(
          `[literature] step fetch pubmed: done elapsedMs=${elapsedMs(fetchPubmedStartedAt)} papers=${pubmedPaperCount}`,
        );
      } catch (error) {
        if (error instanceof LiteratureError && error.statusCode === 404) {
          console.log(
            `[literature] step fetch pubmed: done elapsedMs=${elapsedMs(fetchPubmedStartedAt)} papers=0 (no matches)`,
          );
          emptySourceErrors.push(error);
          continue;
        }

        throw error;
      }
    }
  }

  if (!arxivStepLogged) {
    console.log("[literature] step fetch arxiv: skipped (not selected)");
  }

  if (!pubmedStepLogged) {
    console.log("[literature] step fetch pubmed: skipped (not selected)");
  }

  console.log("[literature] step merge results: start");
  const mergeStartedAt = Date.now();

  if (drafts.length === 0) {
    console.log(
      `[literature] step merge results: done elapsedMs=${elapsedMs(mergeStartedAt)} arxivPapers=${arxivPaperCount} pubmedPapers=${pubmedPaperCount} totalPapers=0`,
    );
    throw (
      emptySourceErrors[0] ??
      new LiteratureError(
        "No papers matched your keywords in the selected date range.",
        404,
      )
    );
  }

  console.log(
    `[literature] step merge results: done elapsedMs=${elapsedMs(mergeStartedAt)} arxivPapers=${arxivPaperCount} pubmedPapers=${pubmedPaperCount} totalPapers=${drafts.length}`,
  );

  return drafts;
}
