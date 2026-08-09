import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import { GrantDocumentDraftSchema, type GrantDocumentDraft } from "../domain/contracts.ts";
import {
  GrantDocxImportPreviewSchema,
  type GrantDocxImportPreview,
  type GrantImportWarning,
} from "./contracts.ts";

export const MAX_GRANT_DOCX_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;

export class GrantDocxImportError extends Error {
  readonly code: "invalid_file" | "unsupported_file" | "file_too_large" | "empty_document";
  readonly status: number;

  constructor(
    message: string,
    code: "invalid_file" | "unsupported_file" | "file_too_large" | "empty_document",
    status: number,
  ) {
    super(message);
    this.name = "GrantDocxImportError";
    this.code = code;
    this.status = status;
  }
}

type ImportedBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; rows: string[][] };

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  };
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseMammothHtml(html: string): ImportedBlock[] {
  const blocks: ImportedBlock[] = [];
  const pattern = /<(h[1-6]|p|ul|ol|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(pattern)) {
    const tag = match[1].toLowerCase();
    const body = match[2];
    if (tag.startsWith("h")) {
      const text = decodeHtml(body);
      if (text) blocks.push({ kind: "heading", level: Number(tag.slice(1)), text });
      continue;
    }
    if (tag === "p") {
      const text = decodeHtml(body);
      if (text) blocks.push({ kind: "paragraph", text });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((item) => decodeHtml(item[1]))
        .filter(Boolean);
      if (items.length > 0) blocks.push({ kind: "list", ordered: tag === "ol", items });
      continue;
    }
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cell) => decodeHtml(cell[1])))
      .filter((row) => row.length > 0);
    const width = Math.max(0, ...rows.map((row) => row.length));
    if (width > 0) blocks.push({ kind: "table", rows: rows.map((row) => [...row, ...Array(width - row.length).fill("")]) });
  }
  return blocks;
}

const GRANT_BODY_MARKER = /^报告正文/;
const GRANT_BODY_END_MARKER = /^附件信息$/;
const TOP_LEVEL_HEADING = /^[（(][一二三四五六七八九十]+[）)]\s*\S+/;
const THIRD_LEVEL_HEADING = /^\d+\.\d+\.\d+(?:\.\d+)*\s+\S+/;
const SECOND_LEVEL_HEADING = /^\d+\.\d+\s+\S+/;
const REFERENCES_HEADING = /^参考文献(?:\s|$)/;

function normalizedBlockText(block: ImportedBlock): string {
  if (block.kind === "heading" || block.kind === "paragraph") return block.text.replace(/\s+/g, " ").trim();
  return "";
}

/**
 * NSFC templates frequently encode visible headings as ordinary Word paragraphs.
 * The importer is the sole authority that classifies those paragraphs. UI layers
 * consume the resulting hierarchy and never repeat these textual heuristics.
 */
function classifyGrantBodyStructure(blocks: ImportedBlock[]): ImportedBlock[] {
  const markerIndex = blocks.findIndex((block) => GRANT_BODY_MARKER.test(normalizedBlockText(block)));
  const bodyStart = markerIndex >= 0 ? markerIndex + 1 : 0;
  const endOffset = blocks.slice(bodyStart).findIndex((block) => GRANT_BODY_END_MARKER.test(normalizedBlockText(block)));
  const bodyEnd = endOffset >= 0 ? bodyStart + endOffset : blocks.length;

  const classified: ImportedBlock[] = blocks.slice(bodyStart, bodyEnd).map((block): ImportedBlock => {
    if (block.kind !== "paragraph") return block;
    const text = normalizedBlockText(block);
    if (TOP_LEVEL_HEADING.test(text)) return { kind: "heading", level: 1, text };
    if (THIRD_LEVEL_HEADING.test(text)) return { kind: "heading", level: 3, text };
    if (SECOND_LEVEL_HEADING.test(text) || REFERENCES_HEADING.test(text)) return { kind: "heading", level: 2, text };
    return block;
  });
  if (markerIndex < 0) return classified;
  const firstBodyHeading = classified.findIndex((block) => block.kind === "heading" && block.level === 1);
  return firstBodyHeading >= 0 ? classified.slice(firstBodyHeading) : classified;
}

function inferSemanticRole(title: string): string {
  const rules: Array<[RegExp, string]> = [
    [/摘要|概述/, "abstract"],
    [/立项依据|研究背景|研究现状/, "rationale"],
    [/研究目标/, "objectives"],
    [/研究内容/, "research_content"],
    [/关键科学问题|科学问题/, "scientific_question"],
    [/技术路线|研究方案|研究方法/, "methodology"],
    [/创新点|特色与创新/, "innovation"],
    [/研究基础|前期基础|工作基础/, "prior_work"],
    [/参考文献/, "references"],
  ];
  return rules.find(([pattern]) => pattern.test(title))?.[1] ?? "custom_section";
}

function blocksToDraft(blocks: ImportedBlock[], title: string): GrantDocumentDraft {
  type DraftSection = GrantDocumentDraft["sections"][number];
  const sections: DraftSection[] = [];
  const lastSectionAtLevel = new Map<number, string>();
  const siblingOrders = new Map<string, number>();
  let current: DraftSection | undefined;
  let sequence = 0;

  const createSection = (sectionTitle: string, level: number): DraftSection => {
    const localKey = `section-${++sequence}`;
    let parentLocalKey: string | undefined;
    for (let candidate = level - 1; candidate >= 1; candidate -= 1) {
      const parent = lastSectionAtLevel.get(candidate);
      if (parent) { parentLocalKey = parent; break; }
    }
    const parentKey = parentLocalKey ?? "root";
    const order = siblingOrders.get(parentKey) ?? 0;
    siblingOrders.set(parentKey, order + 1);
    for (const candidate of [...lastSectionAtLevel.keys()]) {
      if (candidate >= level) lastSectionAtLevel.delete(candidate);
    }
    lastSectionAtLevel.set(level, localKey);
    const section: DraftSection = {
      localKey,
      semanticRole: inferSemanticRole(sectionTitle),
      title: sectionTitle,
      parentLocalKey,
      order,
      nodes: [],
    };
    sections.push(section);
    return section;
  };

  const ensureSection = () => current ?? (current = createSection("申请书正文", 1));
  for (const block of blocks) {
    if (block.kind === "heading" && block.level <= 3) {
      current = createSection(block.text, block.level);
      continue;
    }
    const section = ensureSection();
    const localKey = `node-${++sequence}`;
    if (block.kind === "heading") {
      section.nodes.push({ localKey, nodeType: "heading", content: { text: block.text, level: block.level } });
    } else if (block.kind === "paragraph") {
      section.nodes.push({ localKey, nodeType: "paragraph", content: { text: block.text } });
    } else if (block.kind === "list") {
      section.nodes.push({ localKey, nodeType: "list", content: { ordered: block.ordered, items: block.items } });
    } else {
      section.nodes.push({ localKey, nodeType: "table", content: { rows: block.rows } });
    }
  }
  return GrantDocumentDraftSchema.parse({ title, sections });
}

function inspectPackage(zip: AdmZip): GrantImportWarning[] {
  const warnings: GrantImportWarning[] = [];
  const names = new Set(zip.getEntries().map((entry) => entry.entryName));
  const documentXml = zip.getEntry("word/document.xml")?.getData().toString("utf8") ?? "";
  const add = (condition: boolean, code: GrantImportWarning["code"], message: string) => {
    if (condition && !warnings.some((warning) => warning.code === code)) warnings.push({ code, message });
  };
  add([...names].some((name) => /^word\/header\d*\.xml$/i.test(name)), "header_not_editable", "页眉已保留在原文件中，但不会作为可编辑正文导入。");
  add([...names].some((name) => /^word\/footer\d*\.xml$/i.test(name)), "footer_not_editable", "页脚已保留在原文件中，但不会作为可编辑正文导入。");
  add(/<w:sectPr\b/.test(documentXml), "section_layout_simplified", "分节、页边距和页面方向不会进入正文模型，导出时由模板重新排版。");
  add(/<w:(?:drawing|pict|object)\b/.test(documentXml), "floating_object_not_imported", "浮动图形或嵌入对象不会作为可编辑正文导入。");
  add(/<w:drawing\b/.test(documentXml), "image_not_imported", "原稿中的图片暂不导入编辑器；原文件仍会完整保存。");
  add(/<w:(?:fldSimple|instrText)\b/.test(documentXml), "field_not_imported", "目录、交叉引用或其他 Word 域不会作为可编辑正文导入。");
  add(/<w:commentReference\b/.test(documentXml), "comment_not_imported", "Word 批注不会作为正文导入。");
  add(/<w:(?:ins|del|moveFrom|moveTo)\b/.test(documentXml), "tracked_change_flattened", "修订痕迹将按 Word 当前可见文本展开，不保留审阅历史。");
  add(/<w:footnoteReference\b/.test(documentXml), "footnote_not_imported", "脚注暂不导入编辑器。");
  add(/<w:endnoteReference\b/.test(documentXml), "endnote_not_imported", "尾注暂不导入编辑器。");
  add(/<m:oMath(?:Para)?\b/.test(documentXml), "formula_simplified", "复杂 Word 公式可能被简化，请在预览中核对。");
  return warnings;
}

export async function importGrantDocx(input: { fileName: string; buffer: Buffer }): Promise<GrantDocxImportPreview> {
  const extension = input.fileName.toLowerCase().split(".").pop();
  if (extension !== "docx") {
    throw new GrantDocxImportError("仅支持不含宏的 .docx 初稿。", extension === "docm" ? "unsupported_file" : "invalid_file", 415);
  }
  if (input.buffer.byteLength === 0) throw new GrantDocxImportError("上传的文件为空。", "invalid_file", 400);
  if (input.buffer.byteLength > MAX_GRANT_DOCX_BYTES) throw new GrantDocxImportError("DOCX 不能超过 20 MB。", "file_too_large", 413);
  if (input.buffer[0] !== 0x50 || input.buffer[1] !== 0x4b) throw new GrantDocxImportError("文件不是有效的 DOCX。", "invalid_file", 400);

  let zip: AdmZip;
  try { zip = new AdmZip(input.buffer); } catch { throw new GrantDocxImportError("DOCX 压缩包已损坏。", "invalid_file", 400); }
  const entries = zip.getEntries();
  if (entries.length > MAX_ZIP_ENTRIES || entries.reduce((sum, entry) => sum + entry.header.size, 0) > MAX_UNCOMPRESSED_BYTES) {
    throw new GrantDocxImportError("DOCX 解压内容超出安全限制。", "file_too_large", 413);
  }
  if (!zip.getEntry("word/document.xml")) throw new GrantDocxImportError("DOCX 缺少正文内容。", "invalid_file", 400);

  const result = await mammoth.convertToHtml(
    { buffer: input.buffer },
    { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) },
  );
  const parsedBlocks = parseMammothHtml(result.value);
  const blocks = classifyGrantBodyStructure(parsedBlocks);
  if (blocks.length === 0) throw new GrantDocxImportError("未从 DOCX 中读取到可编辑正文。", "empty_document", 422);
  const title = input.fileName.replace(/\.docx$/i, "").trim() || "导入的国家自然科学基金申请书";
  const draft = blocksToDraft(blocks, title);
  const warnings = inspectPackage(zip);
  for (const message of result.messages) {
    const text = String(message.message ?? "").trim();
    if (text) warnings.push({ code: "parser_warning", message: text });
  }
  return GrantDocxImportPreviewSchema.parse({
    fileName: input.fileName,
    checksum: createHash("sha256").update(input.buffer).digest("hex"),
    draft,
    summary: {
      sectionCount: draft.sections.length,
      paragraphCount: blocks.filter((block) => block.kind === "paragraph").length,
      listCount: blocks.filter((block) => block.kind === "list").length,
      tableCount: blocks.filter((block) => block.kind === "table").length,
    },
    warnings,
  });
}
