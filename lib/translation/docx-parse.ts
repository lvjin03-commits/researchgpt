import AdmZip from "adm-zip";
import {
  MAX_DOCX_TRANSLATION_BYTES,
  MAX_TRANSLATABLE_CHARS,
  MAX_TRANSLATABLE_PARAGRAPHS,
} from "@/lib/translation/constants";
import { TranslationError } from "@/lib/translation/errors";
import { extractDocumentBody, extractParagraphText } from "@/lib/translation/docx-xml";
import { getSkipReason } from "@/lib/translation/skip-rules";
import type { DocxParagraphUnit } from "@/lib/translation/types";

const PARAGRAPH_PATTERN = /<w:p[\s>][\s\S]*?<\/w:p>/g;

export type ParsedDocxDocument = {
  zip: AdmZip;
  documentXmlPath: string;
  documentXml: string;
  paragraphs: DocxParagraphUnit[];
};

function validateDocxBuffer(buffer: Buffer, fileName: string): void {
  if (!fileName.toLowerCase().endsWith(".docx")) {
    throw new TranslationError("Only .docx files are supported.", 400);
  }

  if (buffer.length === 0) {
    throw new TranslationError("The uploaded file is empty.", 400);
  }

  if (buffer.length > MAX_DOCX_TRANSLATION_BYTES) {
    throw new TranslationError(
      `The file exceeds the ${MAX_DOCX_TRANSLATION_BYTES / (1024 * 1024)}MB limit.`,
      413,
    );
  }
}

export function parseDocxDocument(
  buffer: Buffer,
  fileName: string,
): ParsedDocxDocument {
  validateDocxBuffer(buffer, fileName);

  let zip: AdmZip;

  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new TranslationError(
      "Unable to read the Word file. Please upload a valid .docx document.",
      400,
    );
  }

  const documentEntry =
    zip.getEntry("word/document.xml") ?? zip.getEntry("word\\document.xml");

  if (!documentEntry) {
    throw new TranslationError(
      "The Word file is missing document content.",
      400,
    );
  }

  const documentXml = documentEntry.getData().toString("utf8");
  const { prefix } = extractDocumentBody(documentXml);
  const bodyStart = prefix.length;
  const paragraphs: DocxParagraphUnit[] = [];
  let translatableCount = 0;
  let totalChars = 0;

  const bodyMatch = /<w:body[^>]*>([\s\S]*?)<\/w:body>/i.exec(documentXml);
  const body = bodyMatch?.[1] ?? "";

  for (const match of body.matchAll(PARAGRAPH_PATTERN)) {
    if (match.index === undefined) continue;

    const xml = match[0];
    const text = extractParagraphText(xml).replace(/\u0000/g, "").trim();
    const skipReason = getSkipReason(text);
    const translatable = skipReason === null;
    const startIndex = bodyStart + match.index;
    const endIndex = startIndex + xml.length;

    if (translatable) {
      translatableCount += 1;
      totalChars += text.length;

      if (translatableCount > MAX_TRANSLATABLE_PARAGRAPHS) {
        throw new TranslationError(
          `This document has too many paragraphs to translate safely (limit: ${MAX_TRANSLATABLE_PARAGRAPHS}).`,
          413,
        );
      }

      if (totalChars > MAX_TRANSLATABLE_CHARS) {
        throw new TranslationError(
          `This document contains too much translatable text (limit: ${MAX_TRANSLATABLE_CHARS.toLocaleString()} characters).`,
          413,
        );
      }
    }

    paragraphs.push({
      id: `p-${paragraphs.length}`,
      xml,
      text,
      startIndex,
      endIndex,
      translatable,
      skipReason: skipReason ?? undefined,
    });
  }

  if (paragraphs.length === 0) {
    throw new TranslationError(
      "No paragraphs were found in the document.",
      400,
    );
  }

  if (translatableCount === 0) {
    throw new TranslationError(
      "No translatable text was found in the document.",
      400,
    );
  }

  return {
    zip,
    documentXmlPath: documentEntry.entryName,
    documentXml,
    paragraphs,
  };
}
