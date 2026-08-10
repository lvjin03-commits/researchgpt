import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import { GrantDocumentDraftSchema, type GrantDocumentDraft } from "../domain/contracts.ts";
import {
  GrantDocxImportPreviewSchema,
  type GrantDocxImportPreview,
  type GrantImportWarning,
} from "./contracts.ts";
import {
  extractGrantDocxFigures,
  type ExtractedGrantDocxFigure,
  type GrantDocxFigureExtractionIssue,
} from "./docx-figure-extractor.ts";
import type { GrantFigureImportAnchor, GrantImportedFigureAssetDraft } from "../domain/figure-assets.ts";

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
  | { kind: "table"; rows: string[][] }
  | { kind: "figure"; assetId: string };

export type PreparedGrantDocxFigure = Omit<GrantImportedFigureAssetDraft, "storage"> & {
  buffer: Buffer;
  altText: string;
};

export type PreparedGrantDocxImport = {
  preview: GrantDocxImportPreview;
  figures: PreparedGrantDocxFigure[];
};

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

function parseParagraphBody(body: string): ImportedBlock[] {
  const blocks: ImportedBlock[] = [];
  const pattern = /<img\b[^>]*\bsrc="grant-figure:([a-f0-9-]+)"[^>]*>/gi;
  let offset = 0;
  for (const match of body.matchAll(pattern)) {
    const text = decodeHtml(body.slice(offset, match.index));
    if (text) blocks.push({ kind: "paragraph", text });
    blocks.push({ kind: "figure", assetId: match[1] });
    offset = (match.index ?? 0) + match[0].length;
  }
  const text = decodeHtml(body.slice(offset));
  if (text) blocks.push({ kind: "paragraph", text });
  return blocks;
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
      blocks.push(...parseParagraphBody(body));
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

function isFigureCaption(text: string): boolean {
  return /^(?:图|Figure)\s*[A-Za-z0-9一二三四五六七八九十.\-：:]/i.test(text.trim());
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

function blocksToDraft(
  blocks: ImportedBlock[],
  title: string,
  figuresById: Map<string, ExtractedGrantDocxFigure>,
): { draft: GrantDocumentDraft; anchors: Map<string, GrantFigureImportAnchor>; altTextByAssetId: Map<string, string> } {
  type DraftSection = GrantDocumentDraft["sections"][number];
  const sections: DraftSection[] = [];
  const lastSectionAtLevel = new Map<number, string>();
  const siblingOrders = new Map<string, number>();
  let current: DraftSection | undefined;
  let sequence = 0;
  const anchors = new Map<string, GrantFigureImportAnchor>();
  const altTextByAssetId = new Map<string, string>();
  const lastNodeKeyBySection = new Map<string, string>();
  const pendingFigureBySection = new Map<string, string>();

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
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.kind === "heading" && block.level <= 3) {
      current = createSection(block.text, block.level);
      continue;
    }
    const section = ensureSection();
    const localKey = `node-${++sequence}`;
    const previousKey = lastNodeKeyBySection.get(section.localKey) ?? null;
    const pendingAssetId = pendingFigureBySection.get(section.localKey);
    if (pendingAssetId && block.kind !== "figure") {
      const pending = anchors.get(pendingAssetId);
      if (pending) anchors.set(pendingAssetId, { ...pending, followingBlockLocalKey: localKey });
      pendingFigureBySection.delete(section.localKey);
    }
    if (block.kind === "heading") {
      section.nodes.push({ localKey, nodeType: "heading", content: { text: block.text, level: block.level } });
    } else if (block.kind === "paragraph") {
      section.nodes.push({ localKey, nodeType: "paragraph", content: { text: block.text } });
    } else if (block.kind === "list") {
      section.nodes.push({ localKey, nodeType: "list", content: { ordered: block.ordered, items: block.items } });
    } else if (block.kind === "table") {
      section.nodes.push({ localKey, nodeType: "table", content: { rows: block.rows } });
    } else {
      const source = figuresById.get(block.assetId);
      if (!source) continue;
      const next = blocks[index + 1];
      const captionText = next?.kind === "paragraph" && isFigureCaption(next.text) ? next.text : null;
      if (captionText) index += 1;
      const altText = source.altText ?? captionText ?? `Imported figure ${source.sourceOrdinal + 1}`;
      section.nodes.push({
        localKey,
        nodeType: "figure",
        content: { assetId: source.assetId, altText, ...(captionText ? { caption: captionText } : {}) },
      });
      anchors.set(source.assetId, {
        sourceOrdinal: source.sourceOrdinal,
        relationshipId: source.relationshipId,
        partName: source.partName,
        anchorKind: source.anchorKind,
        sectionLocalKey: section.localKey,
        precedingBlockLocalKey: previousKey,
        followingBlockLocalKey: null,
        caption: captionText
          ? { text: captionText, source: "adjacent_paragraph" }
          : { text: null, source: "none" },
      });
      altTextByAssetId.set(source.assetId, altText);
      pendingFigureBySection.set(section.localKey, source.assetId);
    }
    lastNodeKeyBySection.set(section.localKey, localKey);
  }
  return { draft: GrantDocumentDraftSchema.parse({ title, sections }), anchors, altTextByAssetId };
}

function inspectPackage(input: {
  zip: AdmZip;
  extractionIssues: GrantDocxFigureExtractionIssue[];
  extractedFigureCount: number;
  placedFigureCount: number;
  hasFloatingFigure: boolean;
}): GrantImportWarning[] {
  const warnings: GrantImportWarning[] = [];
  const { zip } = input;
  const names = new Set(zip.getEntries().map((entry) => entry.entryName));
  const documentXml = zip.getEntry("word/document.xml")?.getData().toString("utf8") ?? "";
  const add = (condition: boolean, code: GrantImportWarning["code"], message: string) => {
    if (condition && !warnings.some((warning) => warning.code === code)) warnings.push({ code, message });
  };
  add([...names].some((name) => /^word\/header\d*\.xml$/i.test(name)), "header_not_editable", "页眉已保留在原文件中，但不会作为可编辑正文导入。");
  add([...names].some((name) => /^word\/footer\d*\.xml$/i.test(name)), "footer_not_editable", "页脚已保留在原文件中，但不会作为可编辑正文导入。");
  add(/<w:sectPr\b/.test(documentXml), "section_layout_simplified", "分节、页边距和页面方向不会进入正文模型，导出时由模板重新排版。");
  add(/<w:object\b/.test(documentXml), "floating_object_not_imported", "非图片嵌入对象不会作为可编辑正文导入。");
  add(input.hasFloatingFigure, "floating_image_layout_simplified", "浮动图片已按原始阅读顺序导入，绝对坐标和环绕方式不会进入正文模型。");
  add(input.extractedFigureCount > input.placedFigureCount, "image_not_imported", "部分已提取图片未能绑定正文位置；原文件仍会完整保存。");
  for (const issue of input.extractionIssues) {
    const message = issue.code === "image_media_unsupported"
      ? "原稿含暂不支持的图片格式；该图片保留在原文件中，但不会进入可编辑正文。"
      : issue.code === "image_part_missing"
        ? "原稿中的图片部件缺失，无法安全导入；请核对原 Word 文件。"
        : "原稿中的图片关系无效或指向外部资源，无法安全导入。";
    add(true, issue.code, message);
  }
  add(/<w:(?:fldSimple|instrText)\b/.test(documentXml), "field_not_imported", "目录、交叉引用或其他 Word 域不会作为可编辑正文导入。");
  add(/<w:commentReference\b/.test(documentXml), "comment_not_imported", "Word 批注不会作为正文导入。");
  add(/<w:(?:ins|del|moveFrom|moveTo)\b/.test(documentXml), "tracked_change_flattened", "修订痕迹将按 Word 当前可见文本展开，不保留审阅历史。");
  add(/<w:footnoteReference\b/.test(documentXml), "footnote_not_imported", "脚注暂不导入编辑器。");
  add(/<w:endnoteReference\b/.test(documentXml), "endnote_not_imported", "尾注暂不导入编辑器。");
  add(/<m:oMath(?:Para)?\b/.test(documentXml), "formula_simplified", "复杂 Word 公式可能被简化，请在预览中核对。");
  return warnings;
}

export async function prepareGrantDocxImport(input: { fileName: string; buffer: Buffer }): Promise<PreparedGrantDocxImport> {
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

  const checksum = createHash("sha256").update(input.buffer).digest("hex");
  const extraction = await extractGrantDocxFigures(zip);
  const figuresByHash = new Map<string, ExtractedGrantDocxFigure[]>();
  for (const figure of extraction.figures) {
    figuresByHash.set(figure.contentHash, [...(figuresByHash.get(figure.contentHash) ?? []), figure]);
  }
  const result = await mammoth.convertToHtml(
    { buffer: input.buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const imageBuffer = await image.readAsBuffer();
        const hash = createHash("sha256").update(imageBuffer).digest("hex");
        const figure = figuresByHash.get(hash)?.shift();
        return { src: figure ? `grant-figure:${figure.assetId}` : "" };
      }),
    },
  );
  const parsedBlocks = parseMammothHtml(result.value);
  const blocks = classifyGrantBodyStructure(parsedBlocks);
  if (blocks.length === 0) throw new GrantDocxImportError("未从 DOCX 中读取到可编辑正文。", "empty_document", 422);
  const title = input.fileName.replace(/\.docx$/i, "").trim() || "导入的国家自然科学基金申请书";
  const figuresById = new Map(extraction.figures.map((figure) => [figure.assetId, figure]));
  const materialized = blocksToDraft(blocks, title, figuresById);
  const placedFigureIds = new Set(materialized.anchors.keys());
  const warnings = inspectPackage({
    zip,
    extractionIssues: extraction.issues,
    extractedFigureCount: extraction.figures.length,
    placedFigureCount: placedFigureIds.size,
    hasFloatingFigure: extraction.figures.some((figure) => figure.anchorKind === "floating"),
  });
  for (const message of result.messages) {
    const text = String(message.message ?? "").trim();
    if (text) warnings.push({ code: "parser_warning", message: text });
  }
  const preview = GrantDocxImportPreviewSchema.parse({
    fileName: input.fileName,
    checksum,
    draft: materialized.draft,
    summary: {
      sectionCount: materialized.draft.sections.length,
      paragraphCount: blocks.filter((block) => block.kind === "paragraph").length,
      listCount: blocks.filter((block) => block.kind === "list").length,
      tableCount: blocks.filter((block) => block.kind === "table").length,
      figureCount: placedFigureIds.size,
    },
    warnings,
  });
  const figures: PreparedGrantDocxFigure[] = extraction.figures.flatMap((figure) => {
    const anchor = materialized.anchors.get(figure.assetId);
    const altText = materialized.altTextByAssetId.get(figure.assetId);
    if (!anchor || !altText) return [];
    return [{
      assetId: figure.assetId,
      buffer: figure.buffer,
      sourceDocumentChecksum: checksum,
      contentHash: figure.contentHash,
      mediaType: figure.mediaType,
      byteSize: figure.buffer.byteLength,
      widthPx: figure.widthPx,
      heightPx: figure.heightPx,
      anchor,
      altText,
    }];
  });
  return { preview, figures };
}

export async function importGrantDocx(input: { fileName: string; buffer: Buffer }): Promise<GrantDocxImportPreview> {
  return (await prepareGrantDocxImport(input)).preview;
}
