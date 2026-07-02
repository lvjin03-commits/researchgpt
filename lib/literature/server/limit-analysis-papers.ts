// Server-only module.

import { LITERATURE_MAX_ANALYSIS_PAPERS } from "@/lib/literature/constants";
import type { ArxivPaperDraft } from "@/lib/literature/types";

function publishedAtTimestamp(value: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function limitPapersForAnalysis(
  drafts: ArxivPaperDraft[],
): ArxivPaperDraft[] {
  if (drafts.length <= LITERATURE_MAX_ANALYSIS_PAPERS) {
    return drafts;
  }

  console.log(
    `[literature] limiting analysis papers from ${drafts.length} to ${LITERATURE_MAX_ANALYSIS_PAPERS}`,
  );

  return [...drafts]
    .sort(
      (left, right) =>
        publishedAtTimestamp(right.publishedAt) -
        publishedAtTimestamp(left.publishedAt),
    )
    .slice(0, LITERATURE_MAX_ANALYSIS_PAPERS);
}
