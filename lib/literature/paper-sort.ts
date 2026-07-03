import { compareLiteraturePapersAfterAiRerank } from "@/lib/literature/ranking/final-sort";
import type { LiteraturePaper, LiteraturePriority } from "@/lib/literature/types";

export type LiteraturePaperSortKey =
  | "aiRerank"
  | "relevanceScore"
  | "publishedAt"
  | "journalImpactFactor"
  | "citationCount"
  | "priority";

export const LITERATURE_PAPER_SORT_OPTIONS: Array<{
  value: LiteraturePaperSortKey;
  label: string;
}> = [
  { value: "aiRerank", label: "推荐优先级最高" },
  { value: "relevanceScore", label: "相关度最高" },
  { value: "publishedAt", label: "最新发表" },
  { value: "journalImpactFactor", label: "影响因子最高" },
  { value: "citationCount", label: "被引用次数最高" },
  { value: "priority", label: "阅读优先级" },
];

export const DEFAULT_LITERATURE_PAPER_SORT: LiteraturePaperSortKey = "aiRerank";

function priorityRank(priority: LiteraturePriority | null): number {
  switch (priority) {
    case "recommended":
      return 3;
    case "skim":
      return 2;
    case "skip":
      return 1;
    default:
      return 0;
  }
}

function publishedAtSortValue(publishedAt: string | null): number {
  if (!publishedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = new Date(publishedAt).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function compareDescending(left: number, right: number): number {
  return right - left;
}

export function sortLiteraturePapers(
  papers: LiteraturePaper[],
  sortKey: LiteraturePaperSortKey,
): LiteraturePaper[] {
  const sorted = [...papers];

  sorted.sort((left, right) => {
    switch (sortKey) {
      case "aiRerank":
        return compareLiteraturePapersAfterAiRerank(left, right);
      case "relevanceScore":
        return compareDescending(
          left.relevanceScore ?? 0,
          right.relevanceScore ?? 0,
        );
      case "publishedAt":
        return compareDescending(
          publishedAtSortValue(left.publishedAt),
          publishedAtSortValue(right.publishedAt),
        );
      case "journalImpactFactor":
        return compareDescending(
          left.journalImpactFactor ?? 0,
          right.journalImpactFactor ?? 0,
        );
      case "citationCount":
        return compareDescending(
          left.citationCount ?? 0,
          right.citationCount ?? 0,
        );
      case "priority":
        return compareDescending(
          priorityRank(left.priority),
          priorityRank(right.priority),
        );
      default:
        return 0;
    }
  });

  return sorted;
}
