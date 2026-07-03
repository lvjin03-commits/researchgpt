// Server-only module.

import { LITERATURE_MAX_ANALYSIS_PAPERS } from "@/lib/literature/constants";
import type { ArxivPaperDraft } from "@/lib/literature/types";

export function limitPapersForAnalysis(
  drafts: ArxivPaperDraft[],
): ArxivPaperDraft[] {
  if (drafts.length <= LITERATURE_MAX_ANALYSIS_PAPERS) {
    return drafts;
  }

  console.log(
    `[literature] limiting analysis papers from ${drafts.length} to ${LITERATURE_MAX_ANALYSIS_PAPERS} (preserving ranking order)`,
  );

  return drafts.slice(0, LITERATURE_MAX_ANALYSIS_PAPERS);
}
