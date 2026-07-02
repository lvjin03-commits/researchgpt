import type { LiteraturePaper, PaperWorkspaceAnalysis } from "@/lib/literature/types";
import {
  formatLiteratureDate,
  getPaperDoi,
  getPaperExternalId,
  getPaperJournalVenue,
  getPaperSource,
} from "@/lib/literature/paper-display";

function bibtexKey(paper: LiteraturePaper): string {
  const authorPart = (paper.authors[0] ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .slice(0, 12);
  const year = paper.publishedAt
    ? new Date(paper.publishedAt).getFullYear()
    : "nd";
  const idPart = paper.arxivId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return `${authorPart}${year}${idPart}`;
}

function publicationYear(paper: LiteraturePaper): string {
  if (!paper.publishedAt) {
    return "";
  }

  const year = new Date(paper.publishedAt).getFullYear();
  return Number.isNaN(year) ? "" : String(year);
}

export function generateBibTeX(paper: LiteraturePaper): string {
  const doi = getPaperDoi(paper);
  const journal = getPaperJournalVenue(paper);
  const key = bibtexKey(paper);
  const author = paper.authors.length > 0 ? paper.authors.join(" and ") : "Unknown";
  const year = publicationYear(paper);

  const lines = [
    `@article{${key},`,
    `  title = {${paper.title.replace(/[{}]/g, "")}},`,
    `  author = {${author.replace(/[{}]/g, "")}},`,
  ];

  if (year) {
    lines.push(`  year = {${year}},`);
  }

  if (journal) {
    lines.push(`  journal = {${journal.replace(/[{}]/g, "")}},`);
  }

  if (doi) {
    lines.push(`  doi = {${doi}},`);
  }

  if (paper.arxivId.startsWith("pubmed:")) {
    lines.push(`  note = {PubMed:${paper.arxivId.slice("pubmed:".length)}},`);
  } else {
    lines.push(`  eprint = {${paper.arxivId}},`);
    lines.push(`  archivePrefix = {arXiv},`);
  }

  lines.push(`  url = {${paper.absUrl}},`);
  lines.push("}");

  return lines.join("\n");
}

export function generateRIS(paper: LiteraturePaper): string {
  const doi = getPaperDoi(paper);
  const journal = getPaperJournalVenue(paper);
  const lines = ["TY  - JOUR"];

  for (const author of paper.authors) {
    lines.push(`AU  - ${author}`);
  }

  lines.push(`TI  - ${paper.title}`);

  if (journal) {
    lines.push(`JO  - ${journal}`);
  }

  if (paper.publishedAt) {
    lines.push(`DA  - ${formatLiteratureDate(paper.publishedAt)}`);
  }

  if (doi) {
    lines.push(`DO  - ${doi}`);
  }

  lines.push(`UR  - ${paper.absUrl}`);
  lines.push(`AB  - ${paper.abstract.replace(/\n/g, " ")}`);
  lines.push("ER  - ");

  return lines.join("\n");
}

export function generateApaCitation(paper: LiteraturePaper): string {
  const authors =
    paper.authors.length > 0 ? paper.authors.join(", ") : "Unknown authors";
  const year = publicationYear(paper) || "n.d.";
  const journal = getPaperJournalVenue(paper);
  const doi = getPaperDoi(paper);

  let citation = `${authors} (${year}). ${paper.title}.`;

  if (journal) {
    citation += ` ${journal}.`;
  }

  if (doi) {
    citation += ` https://doi.org/${doi}`;
  } else {
    citation += ` ${paper.absUrl}`;
  }

  return citation;
}

export function generatePaperMarkdown(
  paper: LiteraturePaper,
  workspace?: PaperWorkspaceAnalysis | null,
): string {
  const externalId = getPaperExternalId(paper);
  const doi = getPaperDoi(paper);
  const journal = getPaperJournalVenue(paper);
  const lines = [
    `# ${paper.title}`,
    "",
    `**Authors:** ${paper.authors.join(", ") || "Unknown"}`,
    `**Source:** ${getPaperSource(paper)}`,
  ];

  if (journal) {
    lines.push(`**Journal / Venue:** ${journal}`);
  }

  lines.push(`**Published:** ${formatLiteratureDate(paper.publishedAt)}`);

  if (doi) {
    lines.push(`**DOI:** ${doi}`);
  }

  if (externalId) {
    lines.push(`**${externalId.label}:** ${externalId.value}`);
  }

  lines.push("", "## Abstract", "", paper.abstract);

  if (workspace) {
    lines.push(
      "",
      "## AI Analysis",
      "",
      `**One-sentence summary:** ${workspace.oneSentenceSummary}`,
      "",
      `**Research problem:** ${workspace.researchProblem}`,
      "",
      `**Core method:** ${workspace.coreMethod}`,
      "",
      `**Main contributions:** ${workspace.mainContributions}`,
      "",
      `**Experimental results:** ${workspace.experimentalResults}`,
      "",
      `**Limitations:** ${workspace.limitations}`,
      "",
      `**Why it matters:** ${workspace.whyItMatters}`,
    );
  }

  if (paper.personalNotes) {
    lines.push("", "## Personal Notes", "", paper.personalNotes);
  }

  lines.push("", "## Links", "", `- Abstract: ${paper.absUrl}`);

  if (paper.pdfUrl && !paper.arxivId.startsWith("pubmed:")) {
    lines.push(`- PDF: ${paper.pdfUrl}`);
  }

  if (doi) {
    lines.push(`- DOI: https://doi.org/${doi}`);
  }

  return lines.join("\n");
}
