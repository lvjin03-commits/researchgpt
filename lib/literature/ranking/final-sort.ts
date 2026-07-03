import type { LiteraturePaper, LiteraturePriority } from "@/lib/literature/types";

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

export function compareLiteraturePapersAfterAiRerank(
  left: LiteraturePaper,
  right: LiteraturePaper,
): number {
  const priorityDiff =
    priorityRank(right.priority) - priorityRank(left.priority);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  const relevanceDiff =
    (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0);
  if (relevanceDiff !== 0) {
    return relevanceDiff;
  }

  const rankingDiff = (right.rankingScore ?? 0) - (left.rankingScore ?? 0);
  if (rankingDiff !== 0) {
    return rankingDiff;
  }

  return (
    publishedAtSortValue(right.publishedAt) -
    publishedAtSortValue(left.publishedAt)
  );
}

export function sortLiteraturePapersAfterAiRerank(
  papers: LiteraturePaper[],
): LiteraturePaper[] {
  return [...papers].sort(compareLiteraturePapersAfterAiRerank);
}
