import { ExportError } from "@/lib/export/errors";
import type { ExportFormat } from "@/lib/export/types";
import { buildWordDocumentSpec } from "@/lib/export/word-pipeline";

export type ArtifactCompletenessIssueCode =
  | "unfinished_ending"
  | "below_requested_length"
  | "below_longform_floor"
  | "missing_required_section";

export type ArtifactCompletenessIssueSeverity = "repairable" | "blocked";

export type ArtifactCompletenessIssue = {
  code: ArtifactCompletenessIssueCode;
  severity: ArtifactCompletenessIssueSeverity;
  message: string;
  recovery: string;
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
  repairable: boolean;
  blocked: boolean;
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
    /(?:about|around|at least|approximately)?\s*(\d{3,5})\s*words?/iu,
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
  if (/[,，、;；:]$/.test(normalized)) return true;

  const tail = normalized
    .replace(/[。?!？！"'”’）\]]+$/g, "")
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
    /参考文献\s*(待补充|需补充|需要补充|根据原始文献补全)/u.test(content)
  );
}

function addRepairableIssue(
  issues: ArtifactCompletenessIssue[],
  code: ArtifactCompletenessIssueCode,
  message: string,
  recovery: string,
): void {
  issues.push({
    code,
    severity: "repairable",
    message,
    recovery,
  });
}

function inspectAcademicStructure(
  input: ArtifactCompletenessInput,
): ArtifactCompletenessIssue[] {
  const issues: ArtifactCompletenessIssue[] = [];
  const spec = buildWordDocumentSpec({
    title: input.title,
    content: input.content,
  });

  if (!spec.title || spec.title === "ResearchGPT Generated Document") {
    addRepairableIssue(
      issues,
      "missing_required_section",
      "学术长文缺少可用标题。",
      "系统应根据用户主题或正文自动生成一个正式标题。",
    );
  }

  if (!spec.abstract || countTextUnits(spec.abstract) < 60) {
    addRepairableIssue(
      issues,
      "missing_required_section",
      "学术长文缺少摘要，或摘要过短。",
      "系统应补写摘要；如果缺少证据材料，应明确标注为待核对摘要。",
    );
  }

  if (spec.keywords.length === 0 && !/^(keywords?|关键词)\s*[:：]/im.test(input.content)) {
    addRepairableIssue(
      issues,
      "missing_required_section",
      "学术长文缺少关键词。",
      "系统应根据题目和正文自动生成关键词。",
    );
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
    addRepairableIssue(
      issues,
      "missing_required_section",
      "学术长文缺少引言或研究背景。",
      "系统应自动补齐引言章节，不能把这个问题直接返回给用户。",
    );
  }

  if (spec.sections.length < 3) {
    addRepairableIssue(
      issues,
      "missing_required_section",
      "学术长文正文结构过少，至少需要引言、主体讨论和结论类章节。",
      "系统应按文档类型补齐章节骨架，再填充已有内容。",
    );
  }

  if (spec.references.length === 0 && !hasCitationOrReferencePlaceholder(input.content)) {
    addRepairableIssue(
      issues,
      "missing_required_section",
      "学术长文缺少参考文献或引用占位。",
      "系统不能编造参考文献；应插入待补充引用区，并提示用户上传或确认来源。",
    );
  }

  return issues;
}

export function inspectArtifactContentCompleteness(
  input: ArtifactCompletenessInput,
): ArtifactCompletenessReport {
  const required = requiresLongformCheck(input);
  const issues: ArtifactCompletenessIssue[] = [];

  if (!required) {
    return {
      required,
      passed: true,
      repairable: false,
      blocked: false,
      issues,
    };
  }

  const plainText = stripMarkdownSyntax(input.content);
  const combinedRequest = [input.title, getMetadataText(input.metadata)].join("\n");
  const requestedLength = extractRequestedLengthUnits(combinedRequest);
  const textUnits = countTextUnits(plainText);

  if (requestedLength) {
    const minimum = Math.max(500, Math.floor(requestedLength * 0.7));
    if (textUnits < minimum) {
      addRepairableIssue(
        issues,
        "below_requested_length",
        `正文长度明显未达到用户要求：目标约 ${requestedLength}，当前约 ${textUnits}。`,
        "系统应继续生成或按章节补齐，不应导出半成品。",
      );
    }
  } else if (textUnits < 900) {
    addRepairableIssue(
      issues,
      "below_longform_floor",
      `长文正文过短，当前约 ${textUnits} 个文本单位，疑似只生成了开头部分。`,
      "系统应继续生成主体章节和结论，再进入导出。",
    );
  }

  if (endsUnfinished(plainText)) {
    addRepairableIssue(
      issues,
      "unfinished_ending",
      "文档结尾像是被截断。",
      "系统应从断点继续写完最后一句和收尾章节。",
    );
  }

  const templateId = String(input.metadata?.templateId ?? "").toLowerCase();
  const looksAcademic =
    templateId === "nature" ||
    /sci|nature|review|manuscript|综述|论文|文献/i.test(combinedRequest);

  if (looksAcademic) {
    issues.push(...inspectAcademicStructure(input));
  }

  const blocked = issues.some((issue) => issue.severity === "blocked");

  return {
    required,
    passed: issues.length === 0,
    repairable: issues.length > 0 && !blocked,
    blocked,
    issues,
  };
}

export function buildArtifactRecoveryMessage(
  report: ArtifactCompletenessReport,
): string {
  if (report.passed) return "";

  const issueLines = report.issues
    .map((issue) => `- ${issue.message} 处理方式：${issue.recovery}`)
    .join("\n");

  if (report.blocked) {
    return [
      "文档暂时不能直接生成，因为缺少必要条件。",
      "",
      issueLines,
      "",
      "请按上面的提示补充材料或调整要求后，我会继续生成。",
    ].join("\n");
  }

  return [
    "文档还没达到可交付标准，但这些问题属于系统应自动修复的问题。",
    "",
    issueLines,
    "",
    "我会继续补齐结构、长度和收尾，再生成可下载文件。",
  ].join("\n");
}

function firstUsableParagraph(content: string): string {
  return (
    content
      .replace(/```[\s\S]*?```/g, "")
      .split(/\n{2,}/)
      .map((part) =>
        part
          .replace(/^#{1,6}\s+.+$/gm, "")
          .replace(/^[-*+]\s+/gm, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find((part) => countTextUnits(part) >= 40) ?? ""
  );
}

function buildAcademicFallbackSection(input: ArtifactCompletenessInput): string {
  const title = input.title || "Untitled Academic Manuscript";
  const paragraph = firstUsableParagraph(input.content);
  const abstract =
    paragraph ||
    "This manuscript draft was generated from the available user request. Source-specific evidence should be checked and supplemented before academic submission.";

  return [
    `# ${title}`,
    "",
    "## Abstract",
    abstract,
    "",
    "Keywords: to be refined; literature review; research synthesis; evidence mapping",
    "",
    "## 1. Introduction",
    paragraph ||
      "This section should introduce the research background, define the scope of the review, and explain why the topic matters. The current draft reserves this section because the available material was insufficient to form a fully evidenced introduction.",
    "",
    "## 2. Main Discussion",
    input.content.trim() ||
      "The main discussion should be completed after the user provides source materials, target literature, or verified research notes.",
    "",
    "## 3. Evidence, Limitations, and Open Questions",
    "The available draft does not contain enough verified evidence to support detailed claims. Add source papers, datasets, or notes here to strengthen the argument and avoid unsupported conclusions.",
    "",
    "## 4. Conclusions and Outlook",
    "The final document should close with a concise synthesis of the current evidence, the main limitations, and future research directions. This section has been retained so the exported document remains structurally complete.",
    "",
    "## References",
    "- References need to be completed from verified source literature. No fabricated citations were inserted.",
  ].join("\n");
}

function repairAcademicContent(input: ArtifactCompletenessInput): string {
  const spec = buildWordDocumentSpec({
    title: input.title,
    content: input.content,
  });
  const content = input.content.trim();
  const lines: string[] = [];

  if (!content.match(/^#\s+.+$/m)) {
    lines.push(`# ${spec.title || input.title || "Untitled Academic Manuscript"}`);
    lines.push("");
  }

  lines.push(content);

  if (!spec.abstract || countTextUnits(spec.abstract) < 60) {
    lines.push("");
    lines.push("## Abstract");
    lines.push(
      firstUsableParagraph(content) ||
        "This draft was generated from the available material. The abstract should be refined after the user confirms the source evidence and scope.",
    );
  }

  if (spec.keywords.length === 0 && !/^(keywords?|关键词)\s*[:：]/im.test(content)) {
    lines.push("");
    lines.push("Keywords: to be refined; literature review; research synthesis; evidence mapping");
  }

  const headings = spec.sections.map((section) => compactHeading(section.title));
  const hasIntro = headings.some((heading) =>
    ["introduction", "background", "researchbackground", "引言", "研究背景"].includes(
      heading,
    ),
  );
  if (!hasIntro) {
    lines.push("");
    lines.push("## 1. Introduction");
    lines.push(
      "This section introduces the research background and scope. It was added automatically because the original draft did not contain a clearly marked introduction.",
    );
  }

  if (spec.sections.length < 3) {
    lines.push("");
    lines.push("## 2. Main Discussion");
    lines.push(
      "This section should develop the core argument with source-grounded evidence, comparison, and synthesis.",
    );
    lines.push("");
    lines.push("## 3. Conclusions and Outlook");
    lines.push(
      "This section summarizes the main findings, limitations, and future directions.",
    );
  }

  if (spec.references.length === 0 && !hasCitationOrReferencePlaceholder(content)) {
    lines.push("");
    lines.push("## References");
    lines.push(
      "- References need to be completed from verified source literature. No fabricated citations were inserted.",
    );
  }

  const repaired = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const repairedReport = inspectArtifactContentCompleteness({
    ...input,
    content: repaired,
  });

  if (!repairedReport.blocked) return repaired;
  return buildAcademicFallbackSection(input);
}

export function prepareArtifactContentForExport(
  input: ArtifactCompletenessInput,
): { content: string; report: ArtifactCompletenessReport; repaired: boolean } {
  const initialReport = inspectArtifactContentCompleteness(input);
  if (initialReport.passed || initialReport.blocked) {
    return {
      content: input.content,
      report: initialReport,
      repaired: false,
    };
  }

  const repairedContent = repairAcademicContent(input);
  const repairedReport = inspectArtifactContentCompleteness({
    ...input,
    content: repairedContent,
  });

  return {
    content: repairedContent,
    report: repairedReport,
    repaired: repairedContent !== input.content,
  };
}

export function assertArtifactContentComplete(
  input: ArtifactCompletenessInput,
): void {
  const report = inspectArtifactContentCompleteness(input);
  if (report.passed) return;

  throw new ExportError(buildArtifactRecoveryMessage(report), 422);
}
