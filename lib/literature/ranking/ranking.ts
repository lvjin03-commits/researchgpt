import {
  computeLiteratureRankingBreakdown,
  draftToRankingInput,
  type LiteratureRankingBreakdown,
} from "@/lib/literature/ranking/score";
import type { ArxivPaperDraft, LiteratureSettings } from "@/lib/literature/types";

export type RankedLiteraturePaperDraft = ArxivPaperDraft & {
  rankingScore: number;
};

export type RankLiteraturePapersResult = {
  papers: RankedLiteraturePaperDraft[];
  breakdownByArxivId: Map<string, LiteratureRankingBreakdown>;
};

export function rankLiteraturePapers(
  papers: ArxivPaperDraft[],
  settings: Pick<
    LiteratureSettings,
    "keywords" | "researchDirection" | "dateRangeDays"
  >,
): RankLiteraturePapersResult {
  const breakdownByArxivId = new Map<string, LiteratureRankingBreakdown>();

  const ranked = papers.map((paper) => {
    const breakdown = computeLiteratureRankingBreakdown(
      draftToRankingInput(paper, settings),
    );
    breakdownByArxivId.set(paper.arxivId, breakdown);

    return {
      ...paper,
      rankingScore: breakdown.rankingScore,
    };
  });

  ranked.sort((left, right) => right.rankingScore - left.rankingScore);

  return {
    papers: ranked,
    breakdownByArxivId,
  };
}
