import { ExportError } from "@/lib/export/errors";
import type { ExportFormat } from "@/lib/export/types";
import { buildWordDocumentSpec } from "@/lib/export/word-pipeline";

export type ArtifactCompletenessIssue = {
  code:
    | "unfinished_ending"
    | "below_requested_length"
    | "below_longform_floor"
    | "missing_required_section";
  message: string;
};

export type ArtifactCompletenessInput = {
  format: ExportFormat;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type ArtifactCompletenessReport = {
  required: boolean;
  passed: boolean;
  issues: ArtifactCompletenessIssue[];
};

const LONGFORM_FORMATS = new Set<ExportFormat>(["docx", "pdf", "md"]);

const LONGFORM_MARKERS = [
  "sci",
  "nature",
  "review",
  "manuscript",
  "article",
  "report",
  "综述",
  "论文",
  "报告",
  "文献",
  "正文",
  "摘要",
];

const UNFINISHED_ENDINGS = [
  "但",
  "但是",
  "然而",
  "因此",
  "因为",
  "由于",
  "包括",
  "以及",
  "并且",
  "同时",
  "其中",
  "例如",
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "because",
  "however",
  "therefore",
  "with",
  "without",
  "of",
  "for",
  "to",
  "in",
  "on",
  "by",
];

function getMetadataText(metadata?: Record<string, unknown>): string {
  if (!metadata) return "";
  return Object.entries(metadata)
    .map(([key, value]) => `${key}:${String(value ?? "")}`)
    .join("\n");
}

function stripMarkdownSyntax(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```\s*$/, ""),
    )
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[[^\]]+]\([^)]+\)/g, (match) =>
      match.replace(/^\[|\]\([^)]+\)$/g, ""),
    )
    .replace(/<[^>]+>/g, "")
    .replace(/[#>*_`~|:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countTextUnits(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z][A-Za-z'-]*/g)?.length ?? 0;
  return cjk + latinWords;
}

function extractRequestedLengthUnits(text: string): number | null {
  const chineseLength = text.match(
    /(?:约|大约|左右|不少于|至少)?\s*(\d{3,5})\s*字/u,
  );
  if (chineseLength?.[1]) return Number(chineseLength[1]);

  const englishLength = text.match(
    /(?:about|around|at least|approximately)?\s*(\d{3,5})\s*(?:words?|字)/iu,
  );
  if (englishLength?.[1]) return Number(englishLength[1]);

  return null;
}

function requiresLongformCheck(input: ArtifactCompletenessInput): boolean {
  if (!LONGFORM_FORMATS.has(input.format)) return false;
  const combined = [
    input.title,
    input.content.slice(0, 2000),
    getMetadataText(input.metadata),
  ]
    .join("\n")
    .toLowerCase();

  if (String(input.metadata?.templateId ?? "").toLowerCase() === "nature") {
    return true;
  }

  return LONGFORM_MARKERS.some((marker) => combined.includes(marker.toLowerCase()));
}

function endsUnfinished(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  if (/[,，、:：;；]$/.test(normalized)) return true;

  const tail = normalized
    .replace(/[。?!？！]"'”’）\]]+$/g, "")
    .split(/\s+/)
    .slice(-3)
    .join(" ")
    .toLowerCase();

  return UNFINISHED_ENDINGS.some(
    (ending) => tail === ending || tail.endsWith(` ${ending}`),
  );
}

function compactHeading(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\d+(?:\.\d+)*[.)、]?\s*/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function hasCitationOrReferencePlaceholder(content: string): boolean {
  return (
    /^#{1,3}\s*(references|reference|bibliography|参考文献|引用文献)\b/im.test(
      content,
    ) ||
    /\[\d+]/.test(content) ||
    /\(\w+ et al\.,?\s*\d{4}\)/i.test(content) ||
    /references need to be completed|reference list should be completed/i.test(
      content,
    ) ||
    /参考文献.*(待补充|需补充|需要补充|根据原始文献补全)/u.test(content)
  );
}

function addIssue(
  issues: ArtifactCompletenessIssue[],
  message: string,
): void {
  issues.push({
    code: "missing_required_section",
    message,
  });
}

function inspectAcademicStructure(input: ArtifactCompletenessInput): ArtifactCompletenessIssue[] {
  const issues: ArtifactCompletenessIssue[] = [];
  const spec = buildWordDocumentSpec({
    title: input.title,
    content: input.content,
  });

  if (!spec.title || spec.title === "ResearchGPT Generated Document") {
    addIssue(issues, "学术长文档缺少可用标题。");
  }

  if (!spec.abstract || countTextUnits(spec.abstract) < 60) {
    addIssue(issues, "学术长文档缺少摘要，或摘要过短。");
  }

  if (spec.keywords.length === 0 && !/^(keywords?|关键词)\s*[:：]/im.test(input.content)) {
    addIssue(issues, "学术长文档缺少关键词。");
  }

  const headings = spec.sections.map((section) => compactHeading(section.title));
  const hasIntro = headings.some((heading) =>
    [
      "introduction",
      "background",
      "researchbackground",
      "引言",
      "研究背景",
    ].includes(heading),
  );
  if (!hasIntro) {
    addIssue(issues, "学术长文档缺少引言或研究背景。");
  }

  if (spec.sections.length < 3) {
    addIssue(issues, "学术长文档正文结构过少，至少需要引言、主体讨论和结论类章节。");
  }

  if (spec.references.length === 0 && !hasCitationOrReferencePlaceholder(input.content)) {
    addIssue(issues, "学术长文档缺少参考文献或引用占位。");
  }

  return issues;
}

export function inspectArtifactContentCompleteness(
  input: ArtifactCompletenessInput,
): ArtifactCompletenessReport {
  const required = requiresLongformCheck(input);
  const issues: ArtifactCompletenessIssue[] = [];

  if (!required) {
    return { required, passed: true, issues };
  }

  const plainText = stripMarkdownSyntax(input.content);
  const combinedRequest = [input.title, getMetadataText(input.metadata)].join("\n");
  const requestedLength = extractRequestedLengthUnits(combinedRequest);
  const textUnits = countTextUnits(plainText);

  if (requestedLength) {
    const minimum = Math.max(500, Math.floor(requestedLength * 0.7));
    if (textUnits < minimum) {
      issues.push({
        code: "below_requested_length",
        message: `文档正文明显未达到用户要求的长度：目标约 ${requestedLength}，当前约 ${textUnits}。`,
      });
    }
  } else if (textUnits < 900) {
    issues.push({
      code: "below_longform_floor",
      message: `长文档正文过短，当前约 ${textUnits} 个文本单位，疑似只生成了开头部分。`,
    });
  }

  if (endsUnfinished(plainText)) {
    issues.push({
      code: "unfinished_ending",
      message: "文档结尾像是被截断，不能导出半成品。",
    });
  }

  const templateId = String(input.metadata?.templateId ?? "").toLowerCase();
  const looksAcademic =
    templateId === "nature" ||
    /sci|nature|review|manuscript|综述|论文|文献/i.test(combinedRequest);

  if (looksAcademic) {
    issues.push(...inspectAcademicStructure(input));
  }

  return {
    required,
    passed: issues.length === 0,
    issues,
  };
}

export function assertArtifactContentComplete(
  input: ArtifactCompletenessInput,
): void {
  const report = inspectArtifactContentCompleteness(input);
  if (report.passed) return;

  throw new ExportError(
    `文档内容不完整，已阻止导出半成品：${report.issues
      .map((issue) => issue.message)
      .join("；")}`,
    422,
  );
}
