import type { LiteraturePaper, LiteraturePriority } from "@/lib/literature/types";

const PUBLICATION_TYPE_LABELS = new Set([
  "Journal Article",
  "Review",
  "Meta-Analysis",
  "Systematic Review",
  "Clinical Trial",
  "Randomized Controlled Trial",
  "Comparative Study",
  "Evaluation Study",
  "Validation Study",
  "Case Reports",
  "Letter",
  "Editorial",
  "Comment",
  "News",
]);

export function formatLiteratureDate(value: string | null): string {
  if (!value) return "Unknown date";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function literaturePriorityClassName(
  priority: LiteraturePriority | null,
): string {
  switch (priority) {
    case "recommended":
      return "bg-emerald-100 text-emerald-800";
    case "skim":
      return "bg-amber-100 text-amber-800";
    case "skip":
      return "bg-gray-200 text-gray-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

export function getPaperSource(paper: LiteraturePaper): string {
  return paper.arxivId.startsWith("pubmed:") ? "PubMed" : "arXiv";
}

export function getPaperExternalId(
  paper: LiteraturePaper,
): { label: string; value: string } | null {
  if (paper.arxivId.startsWith("pubmed:")) {
    return {
      label: "PubMed ID",
      value: paper.arxivId.slice("pubmed:".length),
    };
  }

  return {
    label: "arXiv ID",
    value: paper.arxivId,
  };
}

export function getPaperJournalVenue(paper: LiteraturePaper): string | null {
  if (!paper.arxivId.startsWith("pubmed:")) {
    return null;
  }

  const journalCandidate = paper.categories[0]?.trim();
  if (!journalCandidate || PUBLICATION_TYPE_LABELS.has(journalCandidate)) {
    return null;
  }

  return journalCandidate;
}

export function getPaperDoi(paper: LiteraturePaper): string | null {
  for (const category of paper.categories) {
    const trimmed = category.trim();
    const lower = trimmed.toLowerCase();

    if (lower.startsWith("doi:")) {
      return trimmed.slice(4).trim();
    }

    if (lower.startsWith("10.")) {
      return trimmed;
    }
  }

  return null;
}

export function getPaperTags(paper: LiteraturePaper): string[] {
  if (paper.arxivId.startsWith("pubmed:")) {
    const journal = getPaperJournalVenue(paper);
    return paper.categories.filter((category) => category !== journal);
  }

  return paper.categories;
}

export function hasPaperPdfLink(paper: LiteraturePaper): boolean {
  if (!paper.pdfUrl) {
    return false;
  }

  return !paper.arxivId.startsWith("pubmed:");
}

export function getPaperDoiUrl(doi: string): string {
  return doi.startsWith("http") ? doi : `https://doi.org/${doi}`;
}
