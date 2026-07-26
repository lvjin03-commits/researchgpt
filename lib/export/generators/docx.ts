// Server-only module. Do not import from client components or /api/chat route entry.

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
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
import type { ExportVisualSpec } from "@/lib/export/artifact-boundary";
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
const FIGURE_IMAGE_WIDTH = 540;
const FIGURE_SVG_WIDTH = 1200;

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

function plainTextFromInlines(inlines: InlineSpan[]): string {
  return inlines.map((span) => span.text).join(" ").replace(/\s+/g, " ").trim();
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function wrapText(value: string, maxChars: number, maxLines = 3): string[] {
  const text = truncateText(value, maxChars * maxLines + 16);
  if (!text) return [];
  const hasSpaces = /\s/.test(text);
  const tokens = hasSpaces ? text.split(/\s+/) : Array.from(text);
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = hasSpaces
      ? current
        ? `${current} ${token}`
        : token
      : `${current}${token}`;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = token;
      if (lines.length >= maxLines) break;
    } else {
      current = candidate;
    }
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length > 0 && text.length > lines.join(hasSpaces ? " " : "").length) {
    lines[lines.length - 1] = truncateText(lines[lines.length - 1], maxChars);
  }
  return lines;
}

function svgText(
  lines: string[],
  x: number,
  y: number,
  options: {
    size?: number;
    weight?: number;
    color?: string;
    anchor?: "start" | "middle";
    lineHeight?: number;
  } = {},
): string {
  const size = options.size ?? 26;
  const lineHeight = options.lineHeight ?? Math.round(size * 1.35);
  const anchor = options.anchor ?? "start";
  return [
    `<text x="${x}" y="${y}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${size}" font-weight="${options.weight ?? 400}" fill="${options.color ?? "#111827"}" text-anchor="${anchor}">`,
    ...lines.map((line, index) =>
      `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    ),
    "</text>",
  ].join("");
}

function parseVisualRaw(spec: ExportVisualSpec): Record<string, unknown> {
  try {
    const parsed = JSON.parse(spec.raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed[0] && typeof parsed[0] === "object"
        ? (parsed[0] as Record<string, unknown>)
        : {};
    }
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function valueString(record: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return fallback;
}

function visualItems(spec: ExportVisualSpec): Array<{ title: string; description: string }> {
  const raw = parseVisualRaw(spec);
  const steps = raw.steps;
  if (Array.isArray(steps)) {
    return steps
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item, index) => ({
        title: valueString(item, ["title", "name", "label"], `Step ${index + 1}`),
        description: valueString(item, ["description", "summary", "detail", "value"]),
      }))
      .slice(0, 6);
  }

  const nodes = raw.nodes;
  if (Array.isArray(nodes)) {
    return nodes
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item, index) => ({
        title: valueString(item, ["title", "name", "label", "id"], `Node ${index + 1}`),
        description: valueString(item, ["description", "summary", "detail"]),
      }))
      .slice(0, 8);
  }

  const data = raw.data;
  if (Array.isArray(data)) {
    return data
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item, index) => ({
        title: valueString(item, ["title", "name", "label", "category"], `Item ${index + 1}`),
        description: valueString(item, ["description", "summary", "value", "result"]),
      }))
      .slice(0, 8);
  }

  return [
    {
      title: spec.title || "Conceptual figure",
      description: spec.caption || "Structured evidence diagram generated from the document content.",
    },
  ];
}

function renderWorkflowSvg(spec: ExportVisualSpec): { svg: string; width: number; height: number } {
  const items = visualItems(spec);
  const count = Math.max(1, items.length);
  const width = FIGURE_SVG_WIDTH;
  const height = count <= 4 ? 520 : 660;
  const margin = 70;
  const title = spec.title || "Conceptual figure";
  const boxWidth = count <= 4 ? 240 : 300;
  const boxHeight = count <= 4 ? 180 : 150;
  const gap = count <= 4 ? 35 : 45;
  const startX = count <= 4 ? 80 : 110;
  const topY = count <= 4 ? 190 : 165;
  const bottomY = 385;
  const palette = ["#EFF6FF", "#ECFDF5", "#FFF7ED", "#F5F3FF", "#F0FDFA", "#FDF2F8"];

  const boxes = items
    .map((item, index) => {
      const row = count <= 4 ? 0 : Math.floor(index / 3);
      const col = count <= 4 ? index : index % 3;
      const x = count <= 4
        ? startX + index * (boxWidth + gap)
        : startX + col * (boxWidth + 65);
      const y = count <= 4 ? topY : topY + row * 205;
      const fill = palette[index % palette.length];
      const arrow =
        index < items.length - 1 && (count <= 4 || col < 2)
          ? `<path d="M ${x + boxWidth + 10} ${y + boxHeight / 2} H ${x + boxWidth + gap - 8}" stroke="#2563EB" stroke-width="4" fill="none" marker-end="url(#arrow)" />`
          : "";
      return [
        `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="18" fill="${fill}" stroke="#93C5FD" stroke-width="2" />`,
        `<circle cx="${x + 34}" cy="${y + 34}" r="18" fill="#1D4ED8" />`,
        svgText([String(index + 1)], x + 34, y + 43, {
          size: 24,
          weight: 700,
          color: "#FFFFFF",
          anchor: "middle",
        }),
        svgText(wrapText(item.title, 18, 2), x + 62, y + 34, {
          size: 25,
          weight: 700,
          color: "#111827",
        }),
        svgText(wrapText(item.description, 26, 3), x + 24, y + 92, {
          size: 21,
          color: "#374151",
        }),
        arrow,
      ].join("");
    })
    .join("");

  const caption = spec.caption || "Author-generated conceptual diagram.";
  return {
    width,
    height,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
          <path d="M 0 0 L 12 6 L 0 12 z" fill="#2563EB" />
        </marker>
      </defs>
      <rect width="100%" height="100%" fill="#FFFFFF" />
      <rect x="36" y="36" width="${width - 72}" height="${height - 72}" rx="22" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="2" />
      ${svgText(wrapText(title, 58, 2), margin, 88, { size: 32, weight: 800, color: "#0F172A" })}
      <line x1="${margin}" y1="122" x2="${width - margin}" y2="122" stroke="#2563EB" stroke-width="4" />
      ${boxes}
      ${svgText(wrapText(caption, 92, 2), margin, height - 58, { size: 18, color: "#64748B" })}
    </svg>`,
  };
}

type RenderedVisualFigure = {
  spec: ExportVisualSpec;
  data: Buffer;
  width: number;
  height: number;
};

function normalizeVisualSpecs(value: unknown): ExportVisualSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ExportVisualSpec => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return typeof record.raw === "string" && typeof record.title === "string";
    })
    .map((item) => ({
      kind: item.kind || "figure",
      title: item.title || "Conceptual figure",
      caption: item.caption || "",
      source: item.source || "",
      raw: item.raw,
    }));
}

async function renderVisualFigures(specs: ExportVisualSpec[]): Promise<RenderedVisualFigure[]> {
  if (specs.length === 0) return [];
  const sharp = (await import("sharp")).default;
  const figures: RenderedVisualFigure[] = [];

  for (const spec of specs) {
    const rendered = renderWorkflowSvg(spec);
    const data = await sharp(Buffer.from(rendered.svg, "utf8")).png().toBuffer();
    figures.push({
      spec,
      data,
      width: rendered.width,
      height: rendered.height,
    });
  }

  return figures;
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

type FigureRenderState = {
  figures: RenderedVisualFigure[];
  cursor: number;
  number: number;
};

function isFigurePlaceholderCallout(block: WordContentBlock): boolean {
  return block.type === "callout" && /^Figure placeholder:/i.test(plainTextFromInlines(block.inlines));
}

function figureBlocks(
  figure: RenderedVisualFigure,
  palette: DocxPalette,
  figureNumber: number,
): Paragraph[] {
  const displayHeight = Math.round(FIGURE_IMAGE_WIDTH * (figure.height / figure.width));
  const caption = figure.spec.caption || figure.spec.title;
  const source = figure.spec.source || "Author-generated conceptual diagram based on the document content.";

  return [
    new Paragraph({
      spacing: { before: 180, after: 90 },
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: "png",
          data: figure.data,
          transformation: {
            width: FIGURE_IMAGE_WIDTH,
            height: Math.min(310, Math.max(210, displayHeight)),
          },
          altText: {
            title: figure.spec.title,
            description: caption,
            name: `Figure ${figureNumber}`,
          },
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60, line: 280 },
      children: [
        textRun(`Figure ${figureNumber}. `, {
          bold: true,
          size: 18,
          color: palette.text,
          font: fontFor(palette),
        }),
        textRun(caption, {
          size: 18,
          color: palette.text,
          font: fontFor(palette),
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 160, line: 260 },
      children: [
        textRun(`Source: ${source}`, {
          size: 16,
          color: palette.muted,
          italics: true,
          font: fontFor(palette),
        }),
      ],
    }),
  ];
}

function consumeFigure(state: FigureRenderState, palette: DocxPalette): Paragraph[] {
  const figure = state.figures[state.cursor];
  if (!figure) return [];
  state.cursor += 1;
  const figureNumber = state.number;
  state.number += 1;
  return figureBlocks(figure, palette, figureNumber);
}

function appendUnusedFigures(state: FigureRenderState, palette: DocxPalette): Paragraph[] {
  const children: Paragraph[] = [];
  while (state.cursor < state.figures.length) {
    children.push(...consumeFigure(state, palette));
  }
  return children;
}

function renderSection(
  section: WordSection,
  palette: DocxPalette,
  figureState: FigureRenderState,
): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [sectionHeading(section, palette)];
  for (const block of section.blocks) {
    if (isFigurePlaceholderCallout(block)) {
      const figure = consumeFigure(figureState, palette);
      if (figure.length > 0) {
        children.push(...figure);
        continue;
      }
    }

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
  figures: RenderedVisualFigure[],
): Array<Paragraph | Table> {
  const figureState: FigureRenderState = {
    figures,
    cursor: 0,
    number: 1,
  };

  return [
    ...buildCover(spec, palette),
    ...buildMetaBlocks(spec, palette),
    ...spec.sections.flatMap((section) => renderSection(section, palette, figureState)),
    ...appendUnusedFigures(figureState, palette),
    ...renderReferences(spec, palette),
    ...renderWarnings(spec, palette),
  ];
}

export async function generateDocxBuffer(
  title: string,
  content: string,
  templateId: ArtifactTemplateId = "academic",
  metadata: Record<string, unknown> = {},
): Promise<Buffer> {
  const spec = buildWordDocumentSpec({ title, content });
  const effectiveTemplateId =
    templateId === "academic" && spec.kind === "sci_review"
      ? "nature"
      : templateId;
  const palette = PALETTES[effectiveTemplateId] ?? PALETTES.academic;
  const font = fontFor(palette);
  const pageMargins = palette.pageMargins ?? {
    top: 1440,
    right: 1440,
    bottom: 1440,
    left: 1440,
  };
  const figures = await renderVisualFigures(normalizeVisualSpecs(metadata.visualSpecs));
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
        children: buildDocxChildren(spec, palette, figures),
      },
    ],
  });

  return Packer.toBuffer(document);
}
