import { createHash } from "node:crypto";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  PageNumber,
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
  FinalDocumentSpecSchema,
  type FinalDocumentSpec,
  type VerifiedReference,
} from "../contracts";
import { assembleDocumentManifest } from "../assembly/manifest";
import { citationSegmentSeparator } from "../citations/segments";
import { assertRenderedDocumentQuality } from "./quality";
import {
  resolveSciWordFonts,
  SCI_WORD_STYLE_REGISTRY,
} from "./style-registry";

const TWIPS_PER_POINT = 20;
const A4_WIDTH_DXA = SCI_WORD_STYLE_REGISTRY.page.widthDxa;
const A4_HEIGHT_DXA = SCI_WORD_STYLE_REGISTRY.page.heightDxa;
const VERTICAL_PAGE_MARGIN_DXA = SCI_WORD_STYLE_REGISTRY.page.verticalMarginDxa;
const HORIZONTAL_PAGE_MARGIN_DXA = SCI_WORD_STYLE_REGISTRY.page.horizontalMarginDxa;
const CONTENT_WIDTH_DXA = A4_WIDTH_DXA - HORIZONTAL_PAGE_MARGIN_DXA * 2;
const TITLE_COLOR = SCI_WORD_STYLE_REGISTRY.colors.title;
const TEXT_COLOR = SCI_WORD_STYLE_REGISTRY.colors.text;
const CAPTION_COLOR = SCI_WORD_STYLE_REGISTRY.colors.caption;
const TABLE_HEADER_FILL = SCI_WORD_STYLE_REGISTRY.colors.tableHeaderFill;
const STYLE_ROLES = SCI_WORD_STYLE_REGISTRY.paragraphRoles;
const PIXELS_PER_MM_AT_96_DPI = 96 / 25.4;

export class DocumentV2RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentV2RenderError";
  }
}

function halfPoints(points: number): number {
  return points * 2;
}

function points(pointsValue: number): number {
  return pointsValue * TWIPS_PER_POINT;
}

function fonts(language: FinalDocumentSpec["metadata"]["language"]) {
  return resolveSciWordFonts(language);
}

function referenceText(reference: VerifiedReference, number: number): string {
  const parts = [
    `${number}. ${reference.authors.join(", ")}.`,
    reference.title.endsWith(".") ? reference.title : `${reference.title}.`,
    reference.venue
      ? `${reference.venue}${reference.year ? ` (${reference.year})` : ""}.`
      : reference.year
        ? `${reference.year}.`
        : "",
    reference.doi ? `https://doi.org/${reference.doi}` : reference.url ?? "",
  ];
  return parts.filter(Boolean).join(" ");
}

function citationSuffix(
  citationIds: string[],
  referenceNumbers: ReadonlyMap<string, number>,
): string {
  if (citationIds.length === 0) return "";
  const numbers = citationIds.map((id) => {
    const number = referenceNumbers.get(id);
    if (!number) {
      throw new DocumentV2RenderError(
        `Citation "${id}" has no verified reference number.`,
      );
    }
    return number;
  });
  return ` [${numbers.join(", ")}]`;
}

const TERMINAL_PUNCTUATION_PATTERN = /([.!?;。！？；])$/u;

function citationMarkerRun(input: {
  citationIds: string[];
  referenceNumbers: ReadonlyMap<string, number>;
  language: FinalDocumentSpec["metadata"]["language"];
  display: FinalDocumentSpec["templateSnapshot"]["citationPolicy"]["display"];
}): TextRun | undefined {
  if (input.citationIds.length === 0) return undefined;
  const numbers = [...new Set(input.citationIds)].map((id) => {
    const number = input.referenceNumbers.get(id);
    if (!number) {
      throw new DocumentV2RenderError(
        `Citation "${id}" has no verified reference number.`,
      );
    }
    return number;
  });
  return new TextRun({
    text: `${input.language === "en" ? " " : ""}[${numbers.join(", ")}]`,
    superScript: input.display === "superscript",
  });
}

function segmentCitationRuns(input: {
  text: string;
  citationIds: string[];
  first: boolean;
  previousText?: string;
  referenceNumbers: ReadonlyMap<string, number>;
  language: FinalDocumentSpec["metadata"]["language"];
  policy: FinalDocumentSpec["templateSnapshot"]["citationPolicy"];
}): TextRun[] {
  const separator = input.first
    ? ""
    : citationSegmentSeparator(input.previousText ?? "", input.text);
  const marker = citationMarkerRun({
    citationIds: input.citationIds,
    referenceNumbers: input.referenceNumbers,
    language: input.language,
    display: input.policy.display,
  });
  if (!marker) return [new TextRun({ text: `${separator}${input.text}` })];
  if (input.policy.placement === "before_terminal_punctuation") {
    const match = input.text.match(TERMINAL_PUNCTUATION_PATTERN);
    if (match) {
      return [
        new TextRun({ text: `${separator}${input.text.slice(0, -1)}` }),
        marker,
        new TextRun({ text: match[1] }),
      ];
    }
  }
  return [new TextRun({ text: `${separator}${input.text}` }), marker];
}

function figureCitationSuffix(
  figureAssetIds: string[],
  figureNumbers: ReadonlyMap<string, number>,
  language: FinalDocumentSpec["metadata"]["language"],
): string {
  if (figureAssetIds.length === 0) return "";
  const labels = figureAssetIds.map((assetId) => {
    const number = figureNumbers.get(assetId);
    if (!number) {
      throw new DocumentV2RenderError(
        `Figure reference "${assetId}" has no figure number.`,
      );
    }
    return language === "zh" ? `图 ${number}` : `Fig. ${number}`;
  });
  return language === "zh"
    ? `（见${labels.join("、")}）`
    : ` (see ${labels.join(", ")})`;
}

function finalCaption(caption: string): string {
  return /[.!?。！？]$/.test(caption) ? caption : `${caption}.`;
}

function figureImageRun(
  asset: FinalDocumentSpec["assets"][number],
): ImageRun {
  if (!asset.dataBase64) {
    throw new DocumentV2RenderError(
      `Figure asset "${asset.id}" was not hydrated before rendering.`,
    );
  }
  const data = Buffer.from(asset.dataBase64, "base64");
  const fallback = asset.fallbackPngBase64
    ? Buffer.from(asset.fallbackPngBase64, "base64")
    : undefined;
  const checksum = createHash("sha256")
    .update(data)
    .update(fallback ?? new Uint8Array())
    .digest("hex");
  if (checksum !== asset.sha256) {
    throw new DocumentV2RenderError(
      `Figure asset "${asset.id}" failed checksum verification.`,
    );
  }
  const preferredWidthPx = Math.round(
    asset.preferredDisplayWidthMm * PIXELS_PER_MM_AT_96_DPI,
  );
  const width = Math.min(asset.displayWidthPx, preferredWidthPx);
  const height = Math.max(
    1,
    Math.round(width * (asset.pixelHeight / asset.pixelWidth)),
  );
  const common = {
    transformation: {
      width,
      height,
    },
    altText: {
      title: asset.title,
      description: asset.altText,
      name: asset.id,
    },
  };
  if (asset.format === "png") {
    return new ImageRun({
      type: "png",
      data,
      ...common,
    });
  }
  if (!fallback) {
    throw new DocumentV2RenderError(
      `SVG figure asset "${asset.id}" has no PNG fallback.`,
    );
  }
  return new ImageRun({
    type: "svg",
    data,
    fallback: {
      type: "png",
      data: fallback,
    },
    ...common,
  });
}

function tableCell(
  text: string,
  width: number,
  header: boolean,
  finalRow: boolean,
): TableCell {
  const numeric = /^[-+]?[\d,.]+(?:\s*[A-Za-z°%/]+)?$/.test(text.trim());
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: header
      ? { fill: TABLE_HEADER_FILL, type: ShadingType.CLEAR }
      : undefined,
    margins: { top: 90, bottom: 90, left: 120, right: 120 },
    borders: {
      top: {
        style: header ? BorderStyle.SINGLE : BorderStyle.NONE,
        size: header ? 6 : 0,
        color: TEXT_COLOR,
      },
      bottom: {
        style: header || finalRow ? BorderStyle.SINGLE : BorderStyle.NONE,
        size: header || finalRow ? 6 : 0,
        color: header || finalRow ? TEXT_COLOR : "FFFFFF",
      },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    children: [
      new Paragraph({
        alignment:
          !header && numeric ? AlignmentType.RIGHT : AlignmentType.LEFT,
        spacing: { before: 0, after: 0, line: STYLE_ROLES.caption.lineTwips },
        children: [
          new TextRun({
            text,
            bold: header,
            size: halfPoints(
              header
                ? STYLE_ROLES.tableHeader.sizePt
                : STYLE_ROLES.tableBody.sizePt,
            ),
            color: TEXT_COLOR,
          }),
        ],
      }),
    ],
  });
}

export async function renderFinalDocumentSpecToDocx(
  input: FinalDocumentSpec,
): Promise<Buffer> {
  const spec = FinalDocumentSpecSchema.parse(input);
  const styleIds = spec.templateSnapshot.typography;
  const documentFonts = fonts(spec.metadata.language);
  const assembly = assembleDocumentManifest(spec, CONTENT_WIDTH_DXA);
  const citationManifest = assembly.citation;
  const layoutByBlockId = new Map(
    assembly.layout.map((entry) => [entry.blockId, entry]),
  );
  const captionByBlockId = new Map(
    assembly.captions.map((entry) => [entry.blockId, entry]),
  );
  const referenceById = new Map(
    spec.references.map((reference) => [reference.id, reference]),
  );
  const orderedReferences = citationManifest.orderedReferenceIds.map((id) => {
    const reference = referenceById.get(id);
    if (!reference) {
      throw new DocumentV2RenderError(
        `Citation "${id}" has no verified reference.`,
      );
    }
    return reference;
  });
  const referenceNumbers = new Map(
    orderedReferences.map((reference, index) => [reference.id, index + 1]),
  );
  const assetsById = new Map(spec.assets.map((asset) => [asset.id, asset]));
  const figureNumbers = new Map<string, number>();
  let nextFigureNumber = 1;
  for (const block of spec.blocks) {
    if (block.type !== "figure") continue;
    figureNumbers.set(block.assetId, nextFigureNumber);
    nextFigureNumber += 1;
  }
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      style: styleIds.titleStyle,
      text: spec.metadata.title,
    }),
  ];

  for (const block of spec.blocks) {
    if (block.type === "heading") {
      const style =
        block.level === 1
          ? styleIds.heading1Style
          : block.level === 2
            ? styleIds.heading2Style
            : styleIds.heading3Style;
      children.push(new Paragraph({ style, text: block.text }));
      continue;
    }

    if (block.type === "paragraph") {
      const citationRuns =
        block.citationGranularity === "segment"
          ? block.segments.flatMap((segment, index) =>
              segmentCitationRuns({
                text: segment.text,
                citationIds: segment.citationIds,
                first: index === 0,
                previousText: block.segments[index - 1]?.text,
                referenceNumbers,
                language: spec.metadata.language,
                policy: spec.templateSnapshot.citationPolicy,
              }),
            )
          : [
              new TextRun({
                text: `${block.text}${citationSuffix(block.citationIds, referenceNumbers)}`,
              }),
            ];
      const figureSuffix = figureCitationSuffix(
        block.figureAssetIds,
        figureNumbers,
        spec.metadata.language,
      );
      if (block.role === "abstract") {
        children.push(
          new Paragraph({
            style: "SciAbstract",
            children: [
              new TextRun({
                text: spec.metadata.language === "zh" ? "摘要： " : "Abstract ",
                bold: true,
                font: documentFonts.title,
              }),
              ...citationRuns,
              ...(figureSuffix ? [new TextRun({ text: figureSuffix })] : []),
            ],
          }),
        );
      } else {
        children.push(
          new Paragraph({
            style: styleIds.bodyStyle,
            children: [
              ...citationRuns,
              ...(figureSuffix ? [new TextRun({ text: figureSuffix })] : []),
            ],
          }),
        );
      }
      continue;
    }

    if (block.type === "keywords") {
      children.push(
        new Paragraph({
          style: "SciKeywords",
          children: [
            new TextRun({
              text:
                spec.metadata.language === "zh" ? "关键词： " : "Keywords: ",
              bold: true,
              font: documentFonts.title,
            }),
            new TextRun({
              text: block.values.join(
                spec.metadata.language === "zh" ? "；" : "; ",
              ),
            }),
          ],
        }),
      );
      continue;
    }

    if (block.type === "table") {
      const caption = captionByBlockId.get(block.id);
      const layout = layoutByBlockId.get(block.id);
      if (!caption || caption.kind !== "table" || !layout?.tableColumnWidthsDxa) {
        throw new DocumentV2RenderError(
          `Table block "${block.id}" is missing its assembly projection.`,
        );
      }
      children.push(
        new Paragraph({
          style: styleIds.captionStyle,
          keepNext: true,
          children: [
            new TextRun({
              text: `${caption.label} | `,
              bold: true,
            }),
            new TextRun({ text: caption.title }),
          ],
        }),
      );
      const columnWidths = layout.tableColumnWidthsDxa;
      children.push(
        new Table({
          width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
          layout: TableLayoutType.FIXED,
          columnWidths,
          borders: {
            top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            insideHorizontal: {
              style: BorderStyle.NONE,
              size: 0,
              color: "FFFFFF",
            },
            insideVertical: {
              style: BorderStyle.NONE,
              size: 0,
              color: "FFFFFF",
            },
          },
          rows: [
            new TableRow({
              tableHeader: true,
              children: block.columns.map((column, index) =>
                tableCell(column, columnWidths[index], true, false),
              ),
            }),
            ...block.rows.map(
              (row, rowIndex) =>
                new TableRow({
                  children: row.map((value, index) =>
                    tableCell(
                      value,
                      columnWidths[index],
                      false,
                      rowIndex === block.rows.length - 1,
                    ),
                  ),
                }),
            ),
          ],
        }),
      );
      children.push(
        new Paragraph({ spacing: { after: points(STYLE_ROLES.body.afterPt) } }),
      );
      continue;
    }

    const asset = assetsById.get(block.assetId);
    if (!asset) {
      throw new DocumentV2RenderError(
        `Figure block "${block.id}" references missing asset "${block.assetId}".`,
      );
    }
    const caption = captionByBlockId.get(block.id);
    if (!caption || caption.kind !== "figure") {
      throw new DocumentV2RenderError(
        `Figure block "${block.id}" is missing its assembly projection.`,
      );
    }
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        spacing: {
          before: points(STYLE_ROLES.caption.beforePt),
          after: points(STYLE_ROLES.caption.afterPt),
        },
        children: [figureImageRun(asset)],
      }),
      new Paragraph({
        style: styleIds.captionStyle,
        children: [
          new TextRun({
            text: `${caption.label} | `,
            bold: true,
          }),
          new TextRun({ text: finalCaption(caption.title) }),
        ],
      }),
    );
  }

  if (orderedReferences.length > 0) {
    children.push(
      new Paragraph({
        style: styleIds.heading1Style,
        text: spec.metadata.language === "zh" ? "参考文献" : "References",
      }),
      ...orderedReferences.map(
        (reference, index) =>
          new Paragraph({
            style: styleIds.referenceStyle,
            text: referenceText(reference, index + 1),
          }),
      ),
    );
  }

  const document = new Document({
    creator: "ResearchGPT",
    title: spec.metadata.title,
    description: "ResearchGPT document v2 SCI review",
    styles: {
      default: {
        document: {
          run: {
            font: documentFonts.body,
            size: halfPoints(STYLE_ROLES.body.sizePt),
            color: TEXT_COLOR,
          },
          paragraph: {
            spacing: {
              line: STYLE_ROLES.body.lineTwips,
              after: points(STYLE_ROLES.body.afterPt),
            },
          },
        },
      },
      paragraphStyles: [
        {
          id: styleIds.titleStyle,
          name: "Document Title",
          basedOn: "Normal",
          next: styleIds.bodyStyle,
          quickFormat: true,
          run: {
            font: documentFonts.title,
            size: halfPoints(STYLE_ROLES.title.sizePt),
            bold: true,
            color: TITLE_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: points(STYLE_ROLES.title.beforePt),
              after: points(STYLE_ROLES.title.afterPt),
            },
            keepNext: true,
          },
        },
        {
          id: styleIds.heading1Style,
          name: "Heading 1",
          basedOn: "Normal",
          next: styleIds.bodyStyle,
          quickFormat: true,
          run: {
            font: documentFonts.title,
            size: halfPoints(STYLE_ROLES.heading1.sizePt),
            bold: true,
            color: TEXT_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: points(STYLE_ROLES.heading1.beforePt),
              after: points(STYLE_ROLES.heading1.afterPt),
            },
            keepNext: true,
          },
        },
        {
          id: styleIds.heading2Style,
          name: "Heading 2",
          basedOn: "Normal",
          next: styleIds.bodyStyle,
          quickFormat: true,
          run: {
            font: documentFonts.title,
            size: halfPoints(STYLE_ROLES.heading2.sizePt),
            bold: true,
            color: TEXT_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: points(STYLE_ROLES.heading2.beforePt),
              after: points(STYLE_ROLES.heading2.afterPt),
            },
            keepNext: true,
          },
        },
        {
          id: styleIds.heading3Style,
          name: "Heading 3",
          basedOn: "Normal",
          next: styleIds.bodyStyle,
          quickFormat: true,
          run: {
            font: documentFonts.title,
            size: halfPoints(STYLE_ROLES.heading3.sizePt),
            bold: true,
            color: TEXT_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: points(STYLE_ROLES.heading3.beforePt),
              after: points(STYLE_ROLES.heading3.afterPt),
            },
            keepNext: true,
          },
        },
        {
          id: styleIds.bodyStyle,
          name: "Body Text",
          basedOn: "Normal",
          next: styleIds.bodyStyle,
          quickFormat: true,
          run: {
            font: documentFonts.body,
            size: halfPoints(STYLE_ROLES.body.sizePt),
            color: TEXT_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.JUSTIFIED,
            spacing: {
              before: 0,
              after: points(STYLE_ROLES.body.afterPt),
              line: STYLE_ROLES.body.lineTwips,
            },
          },
        },
        {
          id: "SciAbstract",
          name: "SCI Abstract",
          basedOn: styleIds.bodyStyle,
          next: "SciKeywords",
          quickFormat: true,
          run: {
            font: documentFonts.body,
            size: halfPoints(STYLE_ROLES.abstract.sizePt),
            color: TEXT_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.JUSTIFIED,
            spacing: {
              before: 0,
              after: points(STYLE_ROLES.abstract.afterPt),
              line: STYLE_ROLES.abstract.lineTwips,
            },
          },
        },
        {
          id: "SciKeywords",
          name: "SCI Keywords",
          basedOn: styleIds.bodyStyle,
          next: styleIds.bodyStyle,
          quickFormat: true,
          run: {
            font: documentFonts.body,
            size: halfPoints(STYLE_ROLES.keywords.sizePt),
            color: TEXT_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: 0,
              after: points(STYLE_ROLES.keywords.afterPt),
              line: STYLE_ROLES.keywords.lineTwips,
            },
          },
        },
        {
          id: styleIds.captionStyle,
          name: "Caption",
          basedOn: "Normal",
          next: styleIds.bodyStyle,
          quickFormat: true,
          run: {
            font: documentFonts.caption,
            size: halfPoints(STYLE_ROLES.caption.sizePt),
            color: CAPTION_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: points(STYLE_ROLES.caption.beforePt),
              after: points(STYLE_ROLES.caption.afterPt),
              line: STYLE_ROLES.caption.lineTwips,
            },
          },
        },
        {
          id: styleIds.referenceStyle,
          name: "Reference",
          basedOn: "Normal",
          next: styleIds.referenceStyle,
          quickFormat: true,
          run: {
            font: documentFonts.body,
            size: halfPoints(STYLE_ROLES.reference.sizePt),
            color: TEXT_COLOR,
          },
          paragraph: {
            alignment: AlignmentType.LEFT,
            spacing: {
              before: 0,
              after: points(STYLE_ROLES.reference.afterPt),
              line: STYLE_ROLES.reference.lineTwips,
            },
            indent: {
              left: STYLE_ROLES.reference.hangingDxa,
              hanging: STYLE_ROLES.reference.hangingDxa,
            },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: A4_WIDTH_DXA,
              height: A4_HEIGHT_DXA,
              orientation: "portrait",
            },
            margin: {
              top: VERTICAL_PAGE_MARGIN_DXA,
              right: HORIZONTAL_PAGE_MARGIN_DXA,
              bottom: VERTICAL_PAGE_MARGIN_DXA,
              left: HORIZONTAL_PAGE_MARGIN_DXA,
              header: 567,
              footer: 567,
            },
          },
          verticalAlign: VerticalAlign.TOP,
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  await assertRenderedDocumentQuality({ buffer, spec, assembly });
  return buffer;
}
