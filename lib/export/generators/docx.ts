// Server-only module. Do not import from client components or /api/chat route entry.

import {
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
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
        font: span.code ? "Courier New" : undefined,
        shading: span.code
          ? {
              type: ShadingType.CLEAR,
              fill: "F3F4F6",
            }
          : undefined,
      }),
  );
}

function blocksToDocxParagraphs(content: string): Paragraph[] {
  const blocks = parseMarkdownBlocks(content);
  const paragraphs: Paragraph[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const headingLevel =
          block.level === 1
            ? HeadingLevel.HEADING_1
            : block.level === 2
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3;

        paragraphs.push(
          new Paragraph({
            heading: headingLevel,
            children: inlineSpansToTextRuns(block.inlines),
          }),
        );
        break;
      }
      case "paragraph":
        paragraphs.push(
          new Paragraph({
            children: inlineSpansToTextRuns(block.inlines),
          }),
        );
        break;
      case "bullet":
        for (const item of block.items) {
          paragraphs.push(
            new Paragraph({
              children: inlineSpansToTextRuns(item),
              bullet: { level: 0 },
            }),
          );
        }
        break;
      case "numbered":
        block.items.forEach((item, itemIndex) => {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${itemIndex + 1}. ` }),
                ...inlineSpansToTextRuns(item),
              ],
            }),
          );
        });
        break;
      case "code":
        for (const codeLine of block.content.split("\n")) {
          paragraphs.push(
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
      case "blockquote":
        paragraphs.push(
          new Paragraph({
            children: inlineSpansToTextRuns(block.inlines),
            indent: { left: 720 },
            border: {
              left: {
                color: "D1D5DB",
                size: 12,
                space: 8,
                style: BorderStyle.SINGLE,
              },
            },
          }),
        );
        break;
    }
  }

  if (paragraphs.length === 0) {
    paragraphs.push(
      new Paragraph({
        children: inlineSpansToTextRuns(parseInlineMarkdown(content)),
      }),
    );
  }

  return paragraphs;
}

export async function generateDocxBuffer(content: string): Promise<Buffer> {
  const document = new Document({
    sections: [
      {
        children: blocksToDocxParagraphs(content),
      },
    ],
  });

  return Packer.toBuffer(document);
}
