import type { ExportFormat } from "@/lib/export/types";

const DEFAULT_EXPORT_TITLE = "ResearchGPT 生成文件";
const MAX_TITLE_LENGTH = 90;

const EXPORT_INSTRUCTION_PATTERNS: RegExp[] = [
  /generate\s+file/iu,
  /copy\s+(this\s+)?(markdown|content|text)/iu,
  /copy\s+and\s+paste/iu,
  /select\s+.+(word|excel|pdf|ppt|docx|xlsx|pptx).+format/iu,
  /download\s+link/iu,
  /click\s+.+(generate|download|export)/iu,
  /please\s+.+(copy|paste|download|select|generate)/iu,
  /生成文件/u,
  /下载链接/u,
  /复制.*粘贴/u,
  /粘贴.*(markdown|csv|json|内容)/iu,
  /选择.*(word|excel|pdf|ppt|docx|xlsx|pptx).*格式/iu,
  /点击.*(生成|下载|导出)/u,
  /请.*(复制|粘贴|点击|选择|生成文件|下载)/u,
  /如果.*缺少材料.*(补充|上传|提供)/u,
  /如果.*(接口|存储|模型).*重试/u,
  /下一步[:：]/u,
  /已完成文件生成/u,
  /正文没有在聊天区重复展开/u,
  /避免把聊天回答误当成文档内容/u,
  /文档还没有达到可交付标准/u,
  /系统会继续补齐/u,
  /处理方式[:：]/u,
  /暂未生成[:：]/u,
  /生成失败[:：]/u,
  /我(已|已经)?(为你|帮你)?(准备|整理|生成|写好).{0,80}(word|excel|ppt|pdf|文档|文件|表格)/iu,
  /以下(是|为).{0,80}(完整内容|文档内容|正文|markdown|csv|json|word|excel|ppt|pdf)/iu,
  /下面(是|为).{0,80}(完整内容|文档内容|正文|markdown|csv|json|word|excel|ppt|pdf)/iu,
];

const GUIDE_HEADING_PATTERNS: RegExp[] = [
  /^#{1,6}\s*(word|excel|pdf|ppt|docx|xlsx|pptx).{0,40}(内容|格式|文档|文件|表格)/iu,
  /^(word|excel|pdf|ppt|docx|xlsx|pptx)\s*(文档|文件|表格)?\s*(内容|格式)?\s*[:：]?$/iu,
  /^已生成可下载文件[:：]?$/u,
  /^已生成可下载文件[:：]?.*$/u,
  /^已完成文件生成[:：]?.*$/u,
  /^generated downloadable file[:：]?$/iu,
];

function normalizeLine(line: string): string {
  return line
    .replace(/^\uFEFF/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\d+[.)、]\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .trim();
}

function compactForCompare(value: string): string {
  return normalizeLine(value)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function truncateTitle(title: string): string {
  const normalized = normalizeLine(title).replace(/\s+/g, " ").trim();
  if (!normalized) return DEFAULT_EXPORT_TITLE;
  return normalized.length <= MAX_TITLE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trim()}...`;
}

function looksLikeExportInstruction(line: string): boolean {
  const text = normalizeLine(line);
  if (!text) return false;
  if (GUIDE_HEADING_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return EXPORT_INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

function isDecorativeOrEmpty(line: string): boolean {
  const text = line.trim();
  return !text || /^[-=_*]{3,}$/.test(text);
}

function isLikelyTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function shouldDropLeadingLine(line: string, userQuery?: string): boolean {
  if (isDecorativeOrEmpty(line)) return true;
  const normalized = compactForCompare(line);
  const normalizedQuery = userQuery ? compactForCompare(userQuery) : "";
  if (normalizedQuery && normalized === normalizedQuery) return true;
  return looksLikeExportInstruction(line);
}

function stripLeadingGuidance(content: string, userQuery?: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && shouldDropLeadingLine(lines[0] ?? "", userQuery)) {
    lines.shift();
  }
  while (lines.length > 0 && isDecorativeOrEmpty(lines[0] ?? "")) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

function stripInstructionLinesEverywhere(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    if (looksLikeExportInstruction(line)) continue;
    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function unwrapPrimaryMarkdownFence(content: string, format?: ExportFormat): string {
  if (!["docx", "pdf", "md", "txt"].includes(format ?? "")) return content;
  const trimmed = content.trim();
  const fullFence = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/iu.exec(
    trimmed,
  );
  if (fullFence?.[1]?.trim()) return fullFence[1].trim();

  const firstFence = /```(markdown|md|text)\s*\n([\s\S]*?)\n```/iu.exec(
    trimmed,
  );
  if (!firstFence?.[2]?.trim()) return content;

  const before = trimmed.slice(0, firstFence.index).trim();
  const after = trimmed.slice(firstFence.index + firstFence[0].length).trim();
  const beforeIsGuide =
    !before || before.split("\n").every((line) => shouldDropLeadingLine(line));
  const afterIsGuide =
    !after || after.split("\n").every((line) => shouldDropLeadingLine(line));

  return beforeIsGuide && afterIsGuide ? firstFence[2].trim() : content;
}

function dropDuplicateTitleHeading(content: string, title?: string): string {
  if (!title) return content.trim();
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const titleKey = compactForCompare(title);
  if (!titleKey || lines.length === 0) return content.trim();

  const first = lines[0] ?? "";
  if (/^#{1,2}\s+/.test(first) && compactForCompare(first) === titleKey) {
    lines.shift();
    while (lines.length > 0 && isDecorativeOrEmpty(lines[0] ?? "")) {
      lines.shift();
    }
  }
  return lines.join("\n").trim();
}

function removeGuidance(content: string, userQuery?: string, format?: ExportFormat): string {
  const withoutLeadingGuidance = stripLeadingGuidance(content, userQuery);
  const unwrapped = unwrapPrimaryMarkdownFence(withoutLeadingGuidance, format);
  return stripInstructionLinesEverywhere(stripLeadingGuidance(unwrapped, userQuery));
}

export function sanitizeExportContent(
  content: string,
  options: { userQuery?: string; title?: string; format?: ExportFormat } = {},
): string {
  const cleaned = dropDuplicateTitleHeading(
    removeGuidance(content, options.userQuery, options.format),
    options.title,
  );
  return cleaned.trim();
}

export function deriveExportTitle(input: {
  requestedTitle: string;
  content: string;
  format?: ExportFormat;
}): string {
  const cleanedContent = sanitizeExportContent(input.content, {
    userQuery: input.requestedTitle,
    format: input.format,
  });
  const lines = cleanedContent.split("\n");

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) continue;
    if (isLikelyTableLine(rawLine)) continue;
    if (/^```/.test(line)) continue;
    if (looksLikeExportInstruction(line)) continue;
    if (line.length < 4 || line.length > 140) continue;
    return truncateTitle(line);
  }

  const requested = normalizeLine(input.requestedTitle);
  if (requested && !looksLikeExportInstruction(requested)) {
    return truncateTitle(requested);
  }

  return DEFAULT_EXPORT_TITLE;
}

export function prepareExportPayload(input: {
  title: string;
  content: string;
  format: ExportFormat;
}): { title: string; content: string } {
  const title = deriveExportTitle({
    requestedTitle: input.title,
    content: input.content,
    format: input.format,
  });
  const content = sanitizeExportContent(input.content, {
    userQuery: input.title,
    title,
    format: input.format,
  });

  return {
    title,
    content: content || input.content.trim(),
  };
}
