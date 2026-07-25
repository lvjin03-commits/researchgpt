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
import type { InlineSpan } from "@/lib/export/markdown-blocks";
import type { ArtifactTemplateId } from "@/lib/export/artifact-planner";
import {
  buildWordDocumentSpec,
  type WordContentBlock,
  type WordDocumentKind,
  type WordDocumentSpec,
  type WordSection,
  type WordTableBlock,
} from "@/lib/export/word-pipeline";

const CONTENT_WIDTH_DXA = 9360;

type DocxPalette = {
  accent: string;
  accentSoft: string;
  text: string;
  muted: string;
  border: string;
  font?: string;
  titleSize?: number;
  bodySize?: number;
  heading1Size?: number;
  heading2Size?: number;
  heading3Size?: number;
  bodyLine?: number;
  paragraphAfter?: number;
  firstLineIndent?: number;
  showKindLabel?: boolean;
  titleAlignment?: typeof AlignmentType.CENTER;
  pageMargins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};

const PALETTES: Record<ArtifactTemplateId, DocxPalette> = {
  academic: {
    accent: "174A7C",
    accentSoft: "EAF2FF",
    text: "111827",
    muted: "4B5563",
    border: "CBD5E1",
  },
  modern: {
    accent: "0F766E",
    accentSoft: "E6FFFA",
    text: "102A43",
    muted: "52616B",
    border: "99F6E4",
  },
  minimal: {
    accent: "475569",
    accentSoft: "F1F5F9",
    text: "111827",
    muted: "64748B",
    border: "CBD5E1",
  },
  nature: {
    accent: "111827",
    accentSoft: "F8FAFC",
    text: "111827",
    muted: "374151",
    border: "D1D5DB",
    font: "Times New Roman",
    titleSize: 36,
    bodySize: 22,
    heading1Size: 28,
    heading2Size: 24,
    heading3Size: 22,
    bodyLine: 420,
    paragraphAfter: 160,
    firstLineIndent: 0,
    showKindLabel: false,
    titleAlignment: AlignmentType.CENTER,
    pageMargins: {
      top: 1440,
      right: 1440,
      bottom: 1440,
      left: 1440,
    },
  },
};

function fontFor(palette: DocxPalette, fallback = "Microsoft YaHei"): string {
  return palette.font ?? fallback;
}

function bodySizeFor(palette: DocxPalette): number {
  return palette.bodySize ?? 21;
}

function bodyLineFor(palette: DocxPalette): number {
  return palette.bodyLine ?? 340;
}

function kindLabel(kind: WordDocumentKind): string {
  switch (kind) {
    case "sci_review":
      return "SCI Review";
    case "paper_reading":
      return "Paper Reading Report";
    case "research_report":
      return "Research Report";
    case "translation":
      return "Academic Translation";
    case "meeting_notes":
      return "Meeting Notes";
    case "general":
      return "Research Document";
  }
}

function normalizeInlineText(text: string): string {
  return text.replace(/\s+/g, " ");
}

function inlineSpansToTextRuns(
  inlines: InlineSpan[],
  options: { size?: number; color?: string; bold?: boolean; font?: string } = {},
): TextRun[] {
  return inlines.map(
    (span) =>
      new TextRun({
        text: normalizeInlineText(span.text),
        bold: options.bold || span.bold,
        italics: span.italic,
        font: span.code ? "Courier New" : (options.font ?? "Microsoft YaHei"),
        size: options.size ?? 21,
        color: options.color,
        shading: span.code
          ? {
              type: ShadingType.CLEAR,
              fill: "F3F4F6",
            }
          : undefined,
      }),
  );
}

function textRun(
  text: string,
  options: {
    size?: number;
    color?: string;
    bold?: boolean;
    italics?: boolean;
    font?: string;
  } = {},
): TextRun {
  return new TextRun({
    text,
    font: options.font ?? "Microsoft YaHei",
    size: options.size ?? 21,
    color: options.color,
    bold: options.bold,
    italics: options.italics,
  });
}

function buildCover(spec: WordDocumentSpec, palette: DocxPalette): Paragraph[] {
  const children: Paragraph[] = [];

  if (palette.showKindLabel !== false) {
    children.push(new Paragraph({
      spacing: { before: 360, after: 140 },
      children: [
        textRun(kindLabel(spec.kind).toUpperCase(), {
          size: 18,
          bold: true,
          color: palette.accent,
          font: fontFor(palette),
        }),
      ],
    }));
  }

  children.push(
    new Paragraph({
      spacing: { after: 420 },
      alignment: palette.titleAlignment,
      children: [
        textRun(spec.title, {
          size: palette.titleSize ?? 38,
          bold: true,
          color: palette.text,
          font: fontFor(palette),
        }),
      ],
    }),
  );

  return children;
}

function buildMetaBlocks(spec: WordDocumentSpec, palette: DocxPalette): Paragraph[] {
  const children: Paragraph[] = [];

  if (spec.abstract) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
        children: [
          textRun("Abstract", {
            bold: true,
            color: palette.accent,
            font: fontFor(palette),
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 180, line: bodyLineFor(palette) },
        children: [
          textRun(spec.abstract, {
            size: bodySizeFor(palette),
            color: palette.text,
            font: fontFor(palette),
          }),
        ],
      }),
    );
  }

  if (spec.keywords.length > 0) {
    children.push(
      new Paragraph({
        spacing: { after: 260 },
        children: [
          textRun("Keywords: ", {
            bold: true,
            color: palette.accent,
            font: fontFor(palette),
          }),
          textRun(spec.keywords.join("; "), {
            color: palette.muted,
            font: fontFor(palette),
          }),
        ],
      }),
    );
  }

  return children;
}

function headingLevel(level: 1 | 2 | 3): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

function sectionHeading(section: WordSection, palette: DocxPalette): Paragraph {
  return new Paragraph({
    heading: headingLevel(section.level),
    spacing: { before: section.level === 1 ? 360 : 220, after: 120 },
    children: [
      textRun(section.title, {
        bold: true,
        size:
          section.level === 1
            ? (palette.heading1Size ?? 28)
            : section.level === 2
              ? (palette.heading2Size ?? 24)
              : (palette.heading3Size ?? 22),
        color: section.level === 1 ? palette.accent : palette.text,
        font: fontFor(palette),
      }),
    ],
  });
}

function paragraphBlock(block: WordContentBlock, palette: DocxPalette): Paragraph | null {
  if (block.type !== "paragraph") return null;
  return new Paragraph({
    spacing: { after: palette.paragraphAfter ?? 140, line: bodyLineFor(palette) },
    indent: { firstLine: palette.firstLineIndent ?? 420 },
    children: inlineSpansToTextRuns(block.inlines, {
      size: bodySizeFor(palette),
      color: palette.text,
      font: fontFor(palette),
    }),
  });
}

function listBlocks(block: WordContentBlock, palette: DocxPalette): Paragraph[] {
  if (block.type !== "list") return [];
  return block.items.map(
    (item, index) =>
      new Paragraph({
        spacing: { after: 90, line: bodyLineFor(palette) },
        indent: { left: 420 },
        children: [
          textRun(block.ordered ? `${index + 1}. ` : "• ", {
            bold: true,
            color: palette.accent,
            font: fontFor(palette),
          }),
          ...inlineSpansToTextRuns(item, {
            size: bodySizeFor(palette),
            color: palette.text,
            font: fontFor(palette),
          }),
        ],
      }),
  );
}

function calloutBlock(block: WordContentBlock, palette: DocxPalette): Paragraph | null {
  if (block.type !== "callout") return null;
  return new Paragraph({
    spacing: { before: 100, after: 160, line: bodyLineFor(palette) },
    indent: { left: 260 },
    shading: {
      type: ShadingType.CLEAR,
      fill: palette.accentSoft,
    },
    border: {
      left: {
        color: palette.accent,
        size: 18,
        space: 8,
        style: BorderStyle.SINGLE,
      },
    },
    children: inlineSpansToTextRuns(block.inlines, {
      size: 20,
      color: palette.text,
      font: fontFor(palette),
    }),
  });
}

function tableColumnWidths(columnCount: number): number[] {
  const safeCount = Math.max(1, columnCount);
  const width = Math.floor(CONTENT_WIDTH_DXA / safeCount);
  const widths = Array.from({ length: safeCount }, () => width);
  widths[widths.length - 1] +=
    CONTENT_WIDTH_DXA - widths.reduce((sum, value) => sum + value, 0);
  return widths;
}

function buildTableCell(
  inlines: InlineSpan[],
  width: number,
  header: boolean,
  palette: DocxPalette,
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    shading: header
      ? { type: ShadingType.CLEAR, fill: palette.accentSoft }
      : undefined,
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0, line: 280 },
        children: inlineSpansToTextRuns(inlines, {
          size: 18,
          color: header ? palette.accent : palette.text,
          bold: header,
          font: fontFor(palette),
        }),
      }),
    ],
  });
}

function tableBlock(block: WordTableBlock, palette: DocxPalette): Array<Paragraph | Table> {
  const widths = tableColumnWidths(block.headers.length);
  return [
    new Paragraph({
      spacing: { before: 160, after: 80 },
      alignment: AlignmentType.CENTER,
      children: [
        textRun(block.caption, {
          size: 19,
          bold: true,
          color: palette.muted,
          font: fontFor(palette),
        }),
      ],
    }),
    new Table({
      width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
      columnWidths: widths,
      layout: TableLayoutType.FIXED,
      borders: {
        top: { style: BorderStyle.SINGLE, color: palette.accent, size: 8 },
        bottom: { style: BorderStyle.SINGLE, color: palette.accent, size: 8 },
        left: { style: BorderStyle.SINGLE, color: palette.border, size: 4 },
        right: { style: BorderStyle.SINGLE, color: palette.border, size: 4 },
        insideHorizontal: { style: BorderStyle.SINGLE, color: palette.border, size: 4 },
        insideVertical: { style: BorderStyle.SINGLE, color: palette.border, size: 4 },
      },
      rows: [
        new TableRow({
          tableHeader: true,
          children: block.headers.map((cell, index) =>
            buildTableCell(cell, widths[index], true, palette),
          ),
        }),
        ...block.rows.map(
          (row) =>
            new TableRow({
              children: row.map((cell, index) =>
                buildTableCell(
                  cell,
                  widths[index] ?? widths[widths.length - 1],
                  false,
                  palette,
                ),
              ),
            }),
        ),
      ],
    }),
    new Paragraph({ spacing: { after: 180 } }),
  ];
}

function renderSection(section: WordSection, palette: DocxPalette): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [sectionHeading(section, palette)];
  for (const block of section.blocks) {
    const paragraph = paragraphBlock(block, palette);
    if (paragraph) {
      children.push(paragraph);
      continue;
    }

    children.push(...listBlocks(block, palette));

    const callout = calloutBlock(block, palette);
    if (callout) {
      children.push(callout);
      continue;
    }

    if (block.type === "table") {
      children.push(...tableBlock(block, palette));
    }
  }
  return children;
}

function renderReferences(spec: WordDocumentSpec, palette: DocxPalette): Paragraph[] {
  if (spec.references.length === 0) return [];
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 380, after: 160 },
      children: [
        textRun("References", {
          bold: true,
          color: palette.accent,
          size: palette.heading1Size ?? 28,
          font: fontFor(palette),
        }),
      ],
    }),
    ...spec.references.map(
      (reference, index) =>
        new Paragraph({
          spacing: { after: 90, line: 300 },
          indent: { hanging: 360 },
          children: [
            textRun(`[${index + 1}] `, {
              bold: true,
              color: palette.accent,
              font: fontFor(palette),
            }),
            textRun(reference, {
              color: palette.text,
              size: bodySizeFor(palette),
              font: fontFor(palette),
            }),
          ],
        }),
    ),
  ];
}

function renderWarnings(spec: WordDocumentSpec, palette: DocxPalette): Paragraph[] {
  if (spec.warnings.length === 0) return [];
  return [
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [
        textRun("Generation Notes", {
          bold: true,
          color: palette.muted,
          font: fontFor(palette),
        }),
      ],
    }),
    ...spec.warnings.map(
      (warning) =>
        new Paragraph({
          spacing: { after: 60 },
          children: [
            textRun(`• ${warning}`, {
              size: 18,
              color: palette.muted,
              font: fontFor(palette),
            }),
          ],
        }),
    ),
  ];
}

function buildDocxChildren(
  spec: WordDocumentSpec,
  palette: DocxPalette,
): Array<Paragraph | Table> {
  return [
    ...buildCover(spec, palette),
    ...buildMetaBlocks(spec, palette),
    ...spec.sections.flatMap((section) => renderSection(section, palette)),
    ...renderReferences(spec, palette),
    ...renderWarnings(spec, palette),
  ];
}

export async function generateDocxBuffer(
  title: string,
  content: string,
  templateId: ArtifactTemplateId = "academic",
): Promise<Buffer> {
  const palette = PALETTES[templateId] ?? PALETTES.academic;
  const spec = buildWordDocumentSpec({ title, content });
  const font = fontFor(palette);
  const pageMargins = palette.pageMargins ?? {
    top: 1440,
    right: 1440,
    bottom: 1440,
    left: 1440,
  };
  const document = new Document({
    creator: "ResearchGPT",
    title: spec.title,
    description: kindLabel(spec.kind),
    styles: {
      default: {
        document: {
          run: {
            font,
            size: bodySizeFor(palette),
            color: palette.text,
          },
          paragraph: {
            spacing: { line: bodyLineFor(palette) },
          },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: palette.heading1Size ?? 28,
            bold: true,
            color: palette.accent,
            font,
          },
          paragraph: {
            spacing: { before: 360, after: 120 },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: palette.heading2Size ?? 24,
            bold: true,
            color: palette.text,
            font,
          },
          paragraph: {
            spacing: { before: 260, after: 100 },
          },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: palette.heading3Size ?? 22,
            bold: true,
            color: palette.text,
            font,
          },
          paragraph: {
            spacing: { before: 220, after: 80 },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: pageMargins,
          },
        },
        children: buildDocxChildren(spec, palette),
      },
    ],
  });

  return Packer.toBuffer(document);
}
