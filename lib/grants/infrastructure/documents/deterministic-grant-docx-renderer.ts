import { createHash } from "node:crypto";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  LevelFormat,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { CanonicalGrantSnapshot } from "../../domain/contracts.ts";
import { GrantDocxArtifactSchema, type GrantDocxArtifact, type GrantExportWarning } from "../../exports/contracts.ts";
import type { GrantDocxRenderer } from "../../ports/grant-docx-renderer.ts";

const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;
const MARGIN = 1440;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
const BODY_FONT = "宋体";
const HEADING_FONT = "微软雅黑";
const BODY_SIZE = 21;
const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "B8C2CC" };

function safeFileName(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${cleaned || "国家自然科学基金申请书"}.docx`;
}

function sectionDepth(sectionId: string, snapshot: CanonicalGrantSnapshot): number {
  const sections = new Map(snapshot.sections.map((section) => [section.sectionId, section]));
  let depth = 1;
  let current = sections.get(sectionId)?.parentSectionId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    depth += 1;
    current = sections.get(current)?.parentSectionId;
  }
  return Math.min(depth, 3);
}

function headingStyle(depth: number): "GrantHeading1" | "GrantHeading2" | "GrantHeading3" {
  return depth === 1 ? "GrantHeading1" : depth === 2 ? "GrantHeading2" : "GrantHeading3";
}

function textParagraph(text: string): Paragraph {
  return new Paragraph({ style: "GrantBody", children: [new TextRun({ text })] });
}

function tableNode(rows: string[][]): Table {
  const columns = Math.max(1, rows[0]?.length ?? 1);
  const columnWidth = Math.floor(CONTENT_WIDTH / columns);
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    indent: { size: 120, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: Array.from({ length: columns }, () => columnWidth),
    borders: { top: TABLE_BORDER, bottom: TABLE_BORDER, left: TABLE_BORDER, right: TABLE_BORDER, insideHorizontal: TABLE_BORDER, insideVertical: TABLE_BORDER },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      children: row.map((cell) => new TableCell({
        width: { size: columnWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 100, bottom: 100, left: 120, right: 120 },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: cell, bold: rowIndex === 0, font: BODY_FONT, size: 18 })],
        })],
      })),
    })),
  });
}

export class DeterministicGrantDocxRenderer implements GrantDocxRenderer {
  async render(input: Parameters<GrantDocxRenderer["render"]>[0]): Promise<GrantDocxArtifact> {
    const warnings: GrantExportWarning[] = [];
    const children: Array<Paragraph | Table> = [new Paragraph({ style: "GrantTitle", text: input.snapshot.title })];
    const nodes = new Map(input.snapshot.nodes.map((node) => [node.nodeId, node]));
    const sections = [...input.snapshot.sections].sort((a, b) => a.order - b.order);
    for (const section of sections) {
      children.push(new Paragraph({ style: headingStyle(sectionDepth(section.sectionId, input.snapshot)), text: section.title }));
      for (const nodeId of section.nodeIds) {
        const node = nodes.get(nodeId);
        if (!node) continue;
        switch (node.nodeType) {
          case "heading":
            children.push(new Paragraph({ style: headingStyle(Math.min(node.content.level, 3)), text: node.content.text }));
            break;
          case "paragraph":
            children.push(textParagraph(node.content.text));
            break;
          case "list":
            node.content.items.forEach((item) => children.push(new Paragraph({
              style: "GrantBody",
              numbering: { reference: node.content.ordered ? "grant-numbering" : "grant-bullets", level: 0 },
              children: [new TextRun({ text: item })],
            })));
            break;
          case "table":
            children.push(tableNode(node.content.rows));
            break;
          case "formula":
            children.push(new Paragraph({ style: "GrantFormula", text: node.content.latex }));
            break;
          case "figure":
            children.push(new Paragraph({ style: "GrantCaption", text: node.content.caption || node.content.altText }));
            warnings.push({ code: "figure_asset_unavailable", nodeId, message: "当前规范快照未包含可读取的图片二进制资产，导出文件保留了图注。" });
            break;
          case "citation":
            warnings.push({ code: "citation_metadata_unavailable", nodeId, message: "当前规范快照只有内部文献标识且缺少已核验书目信息，导出时未显示内部 ID。" });
            break;
        }
      }
    }

    const document = new Document({
      creator: "ResearchGPT",
      title: input.snapshot.title,
      description: `Grant workspace revision ${input.revisionId}`,
      numbering: {
        config: [
          { reference: "grant-numbering", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
          { reference: "grant-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        ],
      },
      styles: {
        default: { document: { run: { font: BODY_FONT, size: BODY_SIZE, color: "222222" }, paragraph: { spacing: { line: 360, after: 120 } } } },
        paragraphStyles: [
          { id: "GrantTitle", name: "Grant Title", basedOn: "Normal", next: "GrantBody", quickFormat: true, run: { font: HEADING_FONT, size: 36, bold: true, color: "111827" }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 360 }, keepNext: true } },
          { id: "GrantHeading1", name: "Grant Heading 1", basedOn: "Normal", next: "GrantBody", quickFormat: true, run: { font: HEADING_FONT, size: 30, bold: true, color: "111827" }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true } },
          { id: "GrantHeading2", name: "Grant Heading 2", basedOn: "Normal", next: "GrantBody", quickFormat: true, run: { font: HEADING_FONT, size: 26, bold: true, color: "1F2937" }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true } },
          { id: "GrantHeading3", name: "Grant Heading 3", basedOn: "Normal", next: "GrantBody", quickFormat: true, run: { font: HEADING_FONT, size: 22, bold: true, color: "374151" }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true } },
          { id: "GrantBody", name: "Grant Body", basedOn: "Normal", next: "GrantBody", quickFormat: true, run: { font: BODY_FONT, size: BODY_SIZE, color: "222222" }, paragraph: { alignment: AlignmentType.JUSTIFIED, spacing: { line: 360, after: 120 }, indent: { firstLine: 420 } } },
          { id: "GrantCaption", name: "Grant Caption", basedOn: "Normal", next: "GrantBody", run: { font: BODY_FONT, size: 18, color: "4B5563" }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 100, after: 160 }, keepNext: true } },
          { id: "GrantFormula", name: "Grant Formula", basedOn: "Normal", next: "GrantBody", run: { font: "Cambria Math", size: BODY_SIZE }, paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 100, after: 160 } } },
        ],
      },
      sections: [{
        properties: { page: { size: { width: A4_WIDTH, height: A4_HEIGHT, orientation: "portrait" }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN, header: 567, footer: 567 } }, verticalAlign: VerticalAlign.TOP },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 18 })] })] }) },
        children,
      }],
    });
    const buffer = Buffer.from(await Packer.toBuffer(document));
    const metadata = GrantDocxArtifactSchema.parse({
      fileName: safeFileName(input.snapshot.title),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      contentHash: createHash("sha256").update(buffer).digest("hex"),
      sourceRevisionId: input.revisionId,
      warnings,
    });
    return { ...metadata, buffer };
  }
}
