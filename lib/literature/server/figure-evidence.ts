// Server-only module.

import type {
  LiteratureFigureEvidence,
  LiteraturePaper,
} from "@/lib/literature/types";

const MAX_FIGURE_EVIDENCE = 16;
const MAX_CAPTION_CHARS = 900;

function normalizeCaption(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim()
    .slice(0, MAX_CAPTION_CHARS);
}

function extractTopics(text: string): string[] {
  const stopwords = new Set([
    "figure",
    "table",
    "panel",
    "results",
    "using",
    "based",
    "shown",
    "analysis",
    "method",
    "model",
    "data",
    "study",
    "research",
  ]);

  const english =
    text
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{3,}/g)
      ?.filter((word) => !stopwords.has(word))
      .slice(0, 8) ?? [];
  const chinese = text.match(/[\u4e00-\u9fff]{2,8}/g)?.slice(0, 6) ?? [];

  return Array.from(new Set([...english, ...chinese])).slice(0, 10);
}

export function extractFigureEvidenceFromText(
  fullText: string | null | undefined,
  paper: Pick<LiteraturePaper, "id" | "title">,
): LiteratureFigureEvidence[] {
  if (!fullText) {
    return [];
  }

  const compact = fullText.replace(/\r/g, "\n").replace(/[ \t]+/g, " ");
  const patterns: Array<{ kind: "figure" | "table"; pattern: RegExp }> = [
    {
      kind: "figure",
      pattern:
        /\b(?:Figure|Fig\.?)\s+([0-9]+[A-Za-z]?)\s*[:.\-–]\s*([\s\S]{40,900}?)(?=\n\s*(?:Figure|Fig\.?|Table)\s+[0-9]+[A-Za-z]?\s*[:.\-–]|\n\s*(?:References|Acknowledg|Supplementary|Methods)\b|$)/gi,
    },
    {
      kind: "table",
      pattern:
        /\bTable\s+([0-9]+[A-Za-z]?)\s*[:.\-–]\s*([\s\S]{30,900}?)(?=\n\s*(?:Figure|Fig\.?|Table)\s+[0-9]+[A-Za-z]?\s*[:.\-–]|\n\s*(?:References|Acknowledg|Supplementary|Methods)\b|$)/gi,
    },
    {
      kind: "figure",
      pattern:
        /(?:^|\n)\s*图\s*([0-9一二三四五六七八九十]+[A-Za-z]?)\s*[:：.\-–]\s*([\s\S]{20,700}?)(?=\n\s*(?:图|表)\s*[0-9一二三四五六七八九十]+[A-Za-z]?\s*[:：.\-–]|\n\s*(?:参考文献|致谢|附录)\b|$)/g,
    },
    {
      kind: "table",
      pattern:
        /(?:^|\n)\s*表\s*([0-9一二三四五六七八九十]+[A-Za-z]?)\s*[:：.\-–]\s*([\s\S]{20,700}?)(?=\n\s*(?:图|表)\s*[0-9一二三四五六七八九十]+[A-Za-z]?\s*[:：.\-–]|\n\s*(?:参考文献|致谢|附录)\b|$)/g,
    },
  ];

  const seen = new Set<string>();
  const evidence: LiteratureFigureEvidence[] = [];

  for (const { kind, pattern } of patterns) {
    for (const match of compact.matchAll(pattern)) {
      const number = match[1]?.trim();
      const caption = normalizeCaption(match[2] ?? "");

      if (!number || caption.length < 30) {
        continue;
      }

      const prefix = kind === "table" ? "Table" : "Figure";
      const label = `${prefix} ${number}`;
      const key = `${kind}:${label}:${caption.slice(0, 80).toLowerCase()}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      evidence.push({
        id: `${paper.id}-${kind}-${number}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
        kind,
        label,
        caption,
        sourceTitle: paper.title,
        page: null,
        topics: extractTopics(`${paper.title} ${caption}`),
      });

      if (evidence.length >= MAX_FIGURE_EVIDENCE) {
        return evidence;
      }
    }
  }

  return evidence;
}
