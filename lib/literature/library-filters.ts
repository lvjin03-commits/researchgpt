import {
  getDisciplineSources,
  isValidDisciplineId,
} from "@/lib/literature/source-taxonomy";
import type { LiteratureDisciplineId } from "@/lib/literature/source-taxonomy";
import type { LiteraturePaper, LiteraturePriority } from "@/lib/literature/types";
import { getPaperSource } from "@/lib/literature/paper-display";

export type LibraryStatusTab = "saved" | "read" | "skipped" | "all";

export type LibraryFilters = {
  status: LibraryStatusTab;
  q: string;
  source: string;
  discipline: string;
  priority: string;
  customCategoryId: string;
};

export function getPaperSourceId(paper: LiteraturePaper): "arxiv" | "pubmed" {
  return paper.arxivId.startsWith("pubmed:") ? "pubmed" : "arxiv";
}

function paperMatchesDiscipline(
  paper: LiteraturePaper,
  discipline: LiteratureDisciplineId,
): boolean {
  const sourceId = getPaperSourceId(paper);
  return getDisciplineSources(discipline).some((source) => source.id === sourceId);
}

function matchesSearchQuery(paper: LiteraturePaper, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalized = query.toLowerCase();
  const authorText = paper.authors.join(" ").toLowerCase();

  return (
    paper.title.toLowerCase().includes(normalized) ||
    paper.abstract.toLowerCase().includes(normalized) ||
    authorText.includes(normalized)
  );
}

export function filterLibraryPapers(
  papers: LiteraturePaper[],
  filters: LibraryFilters,
  paperCategoryIds?: Map<string, string[]>,
): LiteraturePaper[] {
  const libraryStatuses = new Set(["saved", "read", "skipped"]);

  return papers.filter((paper) => {
    const assignedCategoryIds =
      paper.customCategoryIds ?? paperCategoryIds?.get(paper.id) ?? [];

    if (filters.customCategoryId) {
      if (!assignedCategoryIds.includes(filters.customCategoryId)) {
        return false;
      }
    } else if (filters.status === "all") {
      if (!libraryStatuses.has(paper.status)) {
        return false;
      }
    } else if (paper.status !== filters.status) {
      return false;
    }

    if (filters.source && getPaperSourceId(paper) !== filters.source) {
      return false;
    }

    if (
      filters.discipline &&
      isValidDisciplineId(filters.discipline) &&
      !paperMatchesDiscipline(paper, filters.discipline)
    ) {
      return false;
    }

    if (filters.priority && paper.priority !== filters.priority) {
      return false;
    }

    return matchesSearchQuery(paper, filters.q.trim());
  });
}

export function getPaperSourceLabel(paper: LiteraturePaper): string {
  return getPaperSource(paper);
}

export const LIBRARY_PRIORITY_OPTIONS: Array<{
  value: "" | LiteraturePriority;
  label: string;
}> = [
  { value: "", label: "All priorities" },
  { value: "recommended", label: "Recommended" },
  { value: "skim", label: "Skim" },
  { value: "skip", label: "Skip" },
];

export const LIBRARY_SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "arxiv", label: "arXiv" },
  { value: "pubmed", label: "PubMed" },
] as const;

export const LIBRARY_STATUS_TABS: Array<{ value: LibraryStatusTab; label: string }> =
  [
    { value: "saved", label: "Saved" },
    { value: "read", label: "Read" },
    { value: "skipped", label: "Skipped" },
    { value: "all", label: "All" },
  ];
