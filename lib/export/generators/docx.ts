// Server-only module. Do not import from client components or /api/chat route entry.

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  parseInlineMarkdown,
  parseMarkdownBlocks,
  type InlineSpan,
} from "@/lib/export/markdown-blocks";

function inlineSpansToTextRuns(inlines: InlineSpan[]): TextRun[] {
  return inlines.map(
    (span) =>
      new TextRun({
        text: span.text,
        bold: span.bold,
        italics: span.italic,
        font: span.code ? "Courier New" : "Microsoft YaHei",
        shading: span.code
          ? {
              type: ShadingType.CLEAR,
              fill: "F3F4F6",
            }
          : undefined,
      }),
  );
}

function plainText(inlines: InlineSpan[]): string {
  return inlines.map((span) => span.text).join("");
}

function buildCoverParagraphs(title: string): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 720, after: 240 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 40,
          font: "Microsoft YaHei",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 720 },
      children: [
        new TextRun({
          text: "ResearchAI 智能成果文档",
          color: "4B5563",
          size: 22,
          font: "Microsoft YaHei",
        }),
      ],
    }),
  ];
}

function isFigureCallout(text: string): boolean {
  return /^(图表建议|证据图表|Evidence Figure|Evidence Table)[:：]/i.test(text);
}

function cleanFigureCalloutPrefix(text: string): string {
  return text.replace(
    /^(图表建议|证据图表|Evidence Figure|Evidence Table)[:：]\s*/i,
    "",
  );
}

function buildFigureCallout(text: string): Table {
  const parts = cleanFigureCalloutPrefix(text)
    .split("｜")
    .map((part) => part.trim())
    .filter(Boolean);
  const [figureId = "Figure", title = "图表说明", source = "文献证据"] = parts;
  const detail = parts.slice(3).join("｜") || text;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, color: "BFDBFE", size: 8 },
      bottom: { style: BorderStyle.SINGLE, color: "BFDBFE", size: 8 },
      left: { style: BorderStyle.SINGLE, color: "BFDBFE", size: 8 },
      right: { style: BorderStyle.SINGLE, color: "BFDBFE", size: 8 },
      insideHorizontal: { style: BorderStyle.SINGLE, color: "DBEAFE", size: 4 },
      insideVertical: { style: BorderStyle.SINGLE, color: "DBEAFE", size: 4 },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: "EFF6FF" },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${figureId}｜${title}`,
                    bold: true,
                    font: "Microsoft YaHei",
                    color: "1D4ED8",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `来源：${source}`,
                    bold: true,
                    font: "Microsoft YaHei",
                  }),
                ],
              }),
              new Paragraph({
                spacing: { before: 120 },
                children: [
                  new TextRun({
                    text: detail,
                    font: "Microsoft YaHei",
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function buildQuoteParagraph(inlines: InlineSpan[]): Paragraph {
  return new Paragraph({
    children: inlineSpansToTextRuns(inlines),
    indent: { left: 720 },
    spacing: { before: 120, after: 160 },
    shading: {
      type: ShadingType.CLEAR,
      fill: "F9FAFB",
    },
    border: {
      left: {
        color: "2563EB",
        size: 16,
        space: 8,
        style: BorderStyle.SINGLE,
      },
    },
  });
}

const DOCUMENT_CONTENT_WIDTH_DXA = 9720;

function tableColumnWidths(columnCount: number): number[] {
  const weights =
    columnCount === 6
      ? [1.15, 1.35, 1.55, 1.35, 1.55, 1.05]
      : Array.from({ length: columnCount }, () => 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) =>
    Math.floor((DOCUMENT_CONTENT_WIDTH_DXA * weight) / totalWeight),
  );
  widths[widths.length - 1] +=
    DOCUMENT_CONTENT_WIDTH_DXA - widths.reduce((sum, width) => sum + width, 0);
  return widths;
}

function buildMarkdownTable(
  headers: InlineSpan[][],
  rows: InlineSpan[][][],
): Table {
  const widths = tableColumnWidths(headers.length);
  const fontSize = headers.length >= 6 ? 16 : headers.length >= 4 ? 18 : 20;
  const cellMargins = { top: 90, bottom: 90, left: 100, right: 100 };
  const borders = {
    top: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 6 },
    bottom: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 6 },
    left: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 6 },
    right: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 6 },
    insideHorizontal: { style: BorderStyle.SINGLE, color: "E2E8F0", size: 4 },
    insideVertical: { style: BorderStyle.SINGLE, color: "E2E8F0", size: 4 },
  } as const;

  const makeCell = (
    inlines: InlineSpan[],
    columnIndex: number,
    header: boolean,
  ) =>
    new TableCell({
      width: { size: widths[columnIndex], type: WidthType.DXA },
      margins: cellMargins,
      verticalAlign: VerticalAlign.CENTER,
      shading: header
        ? { type: ShadingType.CLEAR, fill: "EAF2FF" }
        : undefined,
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0, line: 260 },
          children: inlines.map(
            (span) =>
              new TextRun({
                text: span.text,
                bold: header || span.bold,
                italics: span.italic,
                font: span.code ? "Courier New" : "Microsoft YaHei",
                shading: span.code
                  ? { type: ShadingType.CLEAR, fill: "F3F4F6" }
                  : undefined,
                size: fontSize,
                color: header ? "163A70" : "172033",
              }),
          ),
        }),
      ],
    });

  return new Table({
    width: { size: DOCUMENT_CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((cell, index) => makeCell(cell, index, true)),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: row.map((cell, index) => makeCell(cell, index, false)),
          }),
      ),
    ],
  });
}

function blocksToDocxChildren(
  title: string,
  content: string,
): Array<Paragraph | Table> {
  const blocks = parseMarkdownBlocks(content);
  const children: Array<Paragraph | Table> = [...buildCoverParagraphs(title)];

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const headingLevel =
          block.level === 1
            ? HeadingLevel.HEADING_1
            : block.level === 2
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3;

        children.push(
          new Paragraph({
            heading: headingLevel,
            spacing: { before: 360, after: 160 },
            children: inlineSpansToTextRuns(block.inlines),
          }),
        );
        break;
      }
      case "paragraph":
        children.push(
          new Paragraph({
            spacing: { after: 160 },
            indent: { firstLine: 420 },
            children: inlineSpansToTextRuns(block.inlines),
          }),
        );
        break;
      case "table":
        children.push(buildMarkdownTable(block.headers, block.rows));
        children.push(new Paragraph({ spacing: { after: 160 } }));
        break;
      case "bullet":
        for (const item of block.items) {
          children.push(
            new Paragraph({
              spacing: { after: 80 },
              children: inlineSpansToTextRuns(item),
              bullet: { level: 0 },
            }),
          );
        }
        break;
      case "numbered":
        block.items.forEach((item, itemIndex) => {
          children.push(
            new Paragraph({
              spacing: { after: 80 },
              children: [
                new TextRun({
                  text: `${itemIndex + 1}. `,
                  bold: true,
                  font: "Microsoft YaHei",
                }),
                ...inlineSpansToTextRuns(item),
              ],
            }),
          );
        });
        break;
      case "code":
        for (const codeLine of block.content.split("\n")) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: codeLine || " ",
                  font: "Courier New",
                }),
              ],
              shading: {
                type: ShadingType.CLEAR,
                fill: "F3F4F6",
              },
            }),
          );
        }
        break;
      case "blockquote": {
        const text = plainText(block.inlines);
        children.push(
          isFigureCallout(text)
            ? buildFigureCallout(text)
            : buildQuoteParagraph(block.inlines),
        );
        break;
      }
    }
  }

  if (children.length === 0) {
    children.push(
      new Paragraph({
        children: inlineSpansToTextRuns(parseInlineMarkdown(content)),
      }),
    );
  }

  return children;
}

export async function generateDocxBuffer(
  title: string,
  content: string,
): Promise<Buffer> {
  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Microsoft YaHei",
            size: 22,
          },
          paragraph: {
            spacing: { line: 360 },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1260,
              bottom: 1440,
              left: 1260,
            },
          },
        },
        children: blocksToDocxChildren(title, content),
      },
    ],
  });

  return Packer.toBuffer(document);
}
