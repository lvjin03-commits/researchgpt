import type {
  LiteraturePaper,
  PaperReadingGuide,
  PaperResearchValue,
  PaperWorkspaceAnalysis,
  PaperWorkspaceDifficulty,
} from "@/lib/literature/types";
import { getPaperDoi } from "@/lib/literature/paper-display";

function extractChineseSection(summary: string, header: string): string {
  const pattern = new RegExp(
    `##\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i",
  );
  const match = summary.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function estimateReadingMinutes(paper: LiteraturePaper): number {
  const wordCount = paper.abstract.split(/\s+/).filter(Boolean).length;
  const base = Math.max(8, Math.round(wordCount / 180));
  return Math.min(45, base);
}

function inferDifficulty(paper: LiteraturePaper): PaperWorkspaceDifficulty {
  const text = `${paper.title} ${paper.abstract}`.toLowerCase();
  const advancedTerms = [
    "theorem",
    "proof",
    "convergence",
    "bayesian",
    "genome",
    "clinical trial",
  ];
  const advancedHits = advancedTerms.filter((term) => text.includes(term)).length;

  if (advancedHits >= 2 || paper.categories.some((c) => c.includes("math"))) {
    return "Advanced";
  }

  if (paper.priority === "recommended" || paper.relevanceScore !== null) {
    return "Intermediate";
  }

  return "Beginner";
}

function inferResearchValue(paper: LiteraturePaper): PaperResearchValue {
  const relevance = paper.relevanceScore ?? 50;
  const scale = (value: number) => Math.max(1, Math.min(5, Math.round(value)));

  const base = relevance / 20;
  let readingPriority = base;

  if (paper.priority === "recommended") {
    readingPriority += 1;
  } else if (paper.priority === "skip") {
    readingPriority -= 1;
  }

  return {
    novelty: scale(base + 0.5),
    technicalDepth: scale(base),
    industrialPotential: scale(base - 0.25),
    readingPriority: scale(readingPriority),
  };
}

function defaultReadingGuide(paper: LiteraturePaper): PaperReadingGuide {
  return {
    estimatedReadingMinutes: estimateReadingMinutes(paper),
    suggestedReadingOrder: [
      "Read the abstract and one-sentence summary",
      "Review the research problem and core method",
      "Study main contributions and experimental results",
      "Check limitations and why it matters",
      "Skim figures/tables if available on the source page",
    ],
    difficulty: inferDifficulty(paper),
  };
}

export function deriveWorkspaceAnalysisFromPaper(
  paper: LiteraturePaper,
): PaperWorkspaceAnalysis {
  const summary = paper.chineseSummary ?? "";
  const researchTopic = extractChineseSection(summary, "研究主题");
  const coreMethod = extractChineseSection(summary, "核心方法");
  const findings = extractChineseSection(summary, "主要发现");
  const contributions = extractChineseSection(summary, "创新点");
  const limitations = extractChineseSection(summary, "局限性");

  const oneSentenceSummary =
    researchTopic.split("\n").find((line) => line.trim()) ||
    paper.recommendationReason ||
    paper.abstract.split(".").find((sentence) => sentence.trim())?.trim() ||
    paper.title;

  return {
    oneSentenceSummary,
    researchProblem:
      researchTopic ||
      `This paper investigates topics related to: ${paper.title}.`,
    coreMethod:
      coreMethod ||
      "Method details are summarized in the abstract and source paper.",
    mainContributions:
      contributions ||
      findings ||
      "See abstract and full paper for contribution details.",
    experimentalResults:
      findings ||
      "Experimental or empirical results are described in the source paper.",
    limitations:
      limitations ||
      "Limitations are not explicitly summarized yet. Review the full paper.",
    whyItMatters:
      paper.recommendationReason ||
      "This paper may be relevant to your literature tracker research direction.",
    readingGuide: defaultReadingGuide(paper),
    researchValue: inferResearchValue(paper),
    generatedAt: new Date().toISOString(),
  };
}

export function getGoogleScholarUrl(paper: LiteraturePaper): string | null {
  const query = getPaperDoi(paper) ?? paper.title.trim();
  if (!query) {
    return null;
  }

  return `https://scholar.google.com/scholar?q=${encodeURIComponent(query)}`;
}

export function getSemanticScholarUrl(paper: LiteraturePaper): string | null {
  const doi = getPaperDoi(paper);
  if (doi) {
    return `https://www.semanticscholar.org/search?q=${encodeURIComponent(doi)}`;
  }

  if (paper.title.trim()) {
    return `https://www.semanticscholar.org/search?q=${encodeURIComponent(paper.title.trim())}`;
  }

  return null;
}

export function isValidWorkspaceAnalysis(value: unknown): value is PaperWorkspaceAnalysis {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const stringFields = [
    "oneSentenceSummary",
    "researchProblem",
    "coreMethod",
    "mainContributions",
    "experimentalResults",
    "limitations",
    "whyItMatters",
    "generatedAt",
  ] as const;

  for (const field of stringFields) {
    if (typeof record[field] !== "string") {
      return false;
    }
  }

  const readingGuide = record.readingGuide;
  if (typeof readingGuide !== "object" || readingGuide === null) {
    return false;
  }

  const guide = readingGuide as Record<string, unknown>;
  if (
    typeof guide.estimatedReadingMinutes !== "number" ||
    !Array.isArray(guide.suggestedReadingOrder) ||
    !guide.suggestedReadingOrder.every((item) => typeof item === "string") ||
    (guide.difficulty !== "Beginner" &&
      guide.difficulty !== "Intermediate" &&
      guide.difficulty !== "Advanced")
  ) {
    return false;
  }

  const researchValue = record.researchValue;
  if (typeof researchValue !== "object" || researchValue === null) {
    return false;
  }

  const scores = researchValue as Record<string, unknown>;
  const scoreFields = [
    "novelty",
    "technicalDepth",
    "industrialPotential",
    "readingPriority",
  ] as const;

  for (const field of scoreFields) {
    const score = scores[field];
    if (typeof score !== "number" || score < 1 || score > 5) {
      return false;
    }
  }

  return true;
}

export function scoreBarWidth(score: number): string {
  return `${Math.max(0, Math.min(100, (score / 5) * 100))}%`;
}
