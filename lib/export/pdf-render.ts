import PDFDocument from "pdfkit";
import {
  inlineSpansToPlainText,
  parseMarkdownBlocks,
  type InlineSpan,
  type MarkdownBlock,
} from "@/lib/export/markdown-blocks";

const PAGE_MARGIN = 54;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2;

type PdfDoc = InstanceType<typeof PDFDocument>;

function appendPlainText(
  doc: PdfDoc,
  text: string,
  options: { fontSize?: number; bold?: boolean; monospace?: boolean } = {},
): void {
  const fontSize = options.fontSize ?? 11;

  doc
    .font(
      options.monospace
        ? "Courier"
        : options.bold
          ? "Helvetica-Bold"
          : "Helvetica",
    )
    .fontSize(fontSize)
    .text(text, {
      width: CONTENT_WIDTH,
      align: "left",
    });
}

function appendInlineSpans(
  doc: PdfDoc,
  inlines: InlineSpan[],
  options: { fontSize?: number; bold?: boolean } = {},
): void {
  appendPlainText(doc, inlineSpansToPlainText(inlines), options);
}

function renderBlock(doc: PdfDoc, block: MarkdownBlock): void {
  switch (block.type) {
    case "heading": {
      const fontSize = block.level === 1 ? 20 : block.level === 2 ? 16 : 14;
      appendInlineSpans(doc, block.inlines, { fontSize, bold: true });
      doc.moveDown(0.4);
      break;
    }
    case "paragraph":
      appendInlineSpans(doc, block.inlines);
      doc.moveDown(0.6);
      break;
    case "bullet":
      for (const item of block.items) {
        appendPlainText(doc, `• ${inlineSpansToPlainText(item)}`);
        doc.moveDown(0.25);
      }
      doc.moveDown(0.35);
      break;
    case "numbered":
      block.items.forEach((item, itemIndex) => {
        appendPlainText(
          doc,
          `${itemIndex + 1}. ${inlineSpansToPlainText(item)}`,
        );
        doc.moveDown(0.25);
      });
      doc.moveDown(0.35);
      break;
    case "code":
      for (const codeLine of block.content.split("\n")) {
        appendPlainText(doc, codeLine || " ", { monospace: true, fontSize: 10 });
        doc.moveDown(0.15);
      }
      doc.moveDown(0.35);
      break;
    case "blockquote":
      appendPlainText(doc, `> ${inlineSpansToPlainText(block.inlines)}`);
      doc.moveDown(0.6);
      break;
  }
}

export function renderMarkdownToPdfBuffer(content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: PAGE_MARGIN,
      autoFirstPage: true,
    });

    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on("error", reject);

    const blocks = parseMarkdownBlocks(content);

    if (blocks.length === 0) {
      appendPlainText(doc, content);
    } else {
      for (const block of blocks) {
        renderBlock(doc, block);
      }
    }

    doc.end();
  });
}
