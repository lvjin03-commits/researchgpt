import type { ExportFormat } from "@/lib/export/types";

const DEFAULT_EXPORT_TITLE = "ResearchGPT 生成文件";
const MAX_TITLE_LENGTH = 90;

const LEADING_GUIDE_PATTERNS: RegExp[] = [
  /^我(已|已经)?(为你|帮你|给你)?(准备|整理|生成|写好).{0,80}(word|excel|ppt|pdf|文档|文件|表格)/iu,
  /^以下(是|为).{0,80}(完整内容|文档内容|正文|markdown|csv|json|word|excel|ppt|pdf)/iu,
  /^下面(是|为).{0,80}(完整内容|文档内容|正文|markdown|csv|json|word|excel|ppt|pdf)/iu,
  /^请(点击|使用|选择|复制|粘贴).{0,100}(generate file|生成文件|下载|word|excel|pdf|ppt|markdown|csv|json)/iu,
  /^要生成.{0,80}(word|excel|pdf|ppt|docx|xlsx|pptx)/iu,
  /^如果你(需要|希望).{0,80}(我可以|可以继续|再生成|继续)/iu,
  /^here is .{0,80}(markdown|csv|json|word|excel|document|file)/iu,
  /^please .{0,100}(generate file|copy|paste|download|select)/iu,
  /^word\s*(文档|文件)?\s*(内容)?\s*(\(.*?\)|（.*?）)?\s*[:：]?$/iu,
  /^excel\s*(文档|文件|表格)?\s*(内容)?\s*(\(.*?\)|（.*?）)?\s*[:：]?$/iu,
  /^pdf\s*(文档|文件)?\s*(内容)?\s*(\(.*?\)|（.*?）)?\s*[:：]?$/iu,
  /^ppt\s*(文档|文件|幻灯片)?\s*(内容)?\s*(\(.*?\)|（.*?）)?\s*[:：]?$/iu,
  /^#+\s*(word|excel|pdf|ppt).{0,30}(内容|格式|文档|文件)/iu,
];

const COMMAND_PATTERNS: RegExp[] = [
  /^(请|帮我|给我|把|将|按|按照|基于|用|以|直接|需要|想要|生成|输出|导出|下载|保存|制作|创建|写|撰写|整理|总结|改成|补成|转成|做成|翻译)/u,
  /(生成|输出|导出|下载|保存|整理|总结|改成|补成|转成|做成|写成|撰写|翻译|制作|创建)/u,
  /(word|docx|excel|xlsx|ppt|pptx|pdf|markdown|md|文件|文档|表格|图片|下载链接)/iu,
  /(generate\s+file|download|export|create\s+(a\s+)?file)/iu,
];

const EXPORT_GUIDE_PATTERNS: RegExp[] = [
  /generate\s+file/iu,
  /生成文件/u,
  /下载链接/u,
  /选择.*(word|excel|pdf|ppt|docx|xlsx|pptx)/iu,
  /(word|excel|pdf|ppt)\s*(文档|文件|表格|幻灯片)?.{0,80}(选择|格式|粘贴|复制|markdown|csv|json)/iu,
  /(粘贴|复制).*?(markdown|csv|json|内容)/iu,
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
  return normalized.length <= MAX_TITLE_LENGTH ? normalized : `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trim()}...`;
}

function looksLikeExportInstruction(line: string): boolean {
  const text = normalizeLine(line);
  if (!text) return false;
  if (LEADING_GUIDE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (EXPORT_GUIDE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const matchCount = COMMAND_PATTERNS.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  return matchCount >= 2;
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
  let changed = true;
  while (changed && lines.length > 0) {
    changed = false;
    while (lines.length > 0 && shouldDropLeadingLine(lines[0] ?? "", userQuery)) {
      lines.shift();
      changed = true;
    }
    while (lines.length > 0 && isDecorativeOrEmpty(lines[0] ?? "")) {
      lines.shift();
      changed = true;
    }
  }
  return lines.join("\n").trim();
}

function unwrapPrimaryMarkdownFence(content: string, format?: ExportFormat): string {
  if (!["docx", "pdf", "md", "txt"].includes(format ?? "")) return content;
  const trimmed = content.trim();
  const fullFence = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```\s*$/iu.exec(trimmed);
  if (fullFence?.[1]?.trim()) return fullFence[1].trim();

  const firstFence = /```(markdown|md|text)\s*\n([\s\S]*?)\n```/iu.exec(trimmed);
  if (!firstFence?.[2]?.trim()) return content;
  const before = trimmed.slice(0, firstFence.index).trim();
  const after = trimmed.slice(firstFence.index + firstFence[0].length).trim();
  const wrapperBefore =
    !before ||
    before.length < 700 ||
    before.split("\n").some((line) => looksLikeExportInstruction(line));
  const guideOnlyBefore = !before || before.split("\n").every((line) => shouldDropLeadingLine(line));
  const guideOnlyAfter = !after || after.split("\n").every((line) => shouldDropLeadingLine(line));
  return (guideOnlyBefore || wrapperBefore) && guideOnlyAfter ? firstFence[2].trim() : content;
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

function removeLeadingInstructionBlock(content: string, userQuery?: string, format?: ExportFormat): string {
  const withoutGuidance = stripLeadingGuidance(content, userQuery);
  const unwrapped = unwrapPrimaryMarkdownFence(withoutGuidance, format);
  return stripLeadingGuidance(unwrapped, userQuery);
}

export function sanitizeExportContent(
  content: string,
  options: { userQuery?: string; title?: string; format?: ExportFormat } = {},
): string {
  const cleaned = dropDuplicateTitleHeading(
    removeLeadingInstructionBlock(content, options.userQuery, options.format),
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
