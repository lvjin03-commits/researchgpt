import AdmZip from "adm-zip";
import {
  createTranslatedParagraphXml,
  setParagraphText,
} from "@/lib/translation/docx-xml";
import type { DocxParagraphUnit, OutputMode } from "@/lib/translation/types";

export function buildTranslatedDocumentXml(
  documentXml: string,
  paragraphs: DocxParagraphUnit[],
  translations: Map<string, string>,
  outputMode: OutputMode,
): string {
  const sorted = [...paragraphs].sort(
    (left, right) => right.startIndex - left.startIndex,
  );

  let updatedXml = documentXml;

  for (const paragraph of sorted) {
    const translatedText = translations.get(paragraph.id) ?? paragraph.text;
    const originalSegment = updatedXml.slice(
      paragraph.startIndex,
      paragraph.endIndex,
    );

    let replacement = originalSegment;

    if (paragraph.translatable) {
      if (outputMode === "bilingual") {
        replacement =
          originalSegment + createTranslatedParagraphXml(translatedText);
      } else {
        replacement = setParagraphText(originalSegment, translatedText);
      }
    }

    updatedXml =
      updatedXml.slice(0, paragraph.startIndex) +
      replacement +
      updatedXml.slice(paragraph.endIndex);
  }

  return updatedXml;
}

export function packTranslatedDocx(
  zip: AdmZip,
  documentXmlPath: string,
  translatedDocumentXml: string,
): Buffer {
  zip.updateFile(documentXmlPath, Buffer.from(translatedDocumentXml, "utf8"));
  return zip.toBuffer();
}

export function buildTranslatedFilename(originalFileName: string): string {
  const baseName = originalFileName.replace(/\.docx$/i, "") || "document";
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  return `${baseName}_translated_${timestamp}.docx`;
}

export function buildTranslationOutputFilename(
  originalFileName: string,
  outputMode: OutputMode,
): string {
  const baseName = originalFileName.replace(/\.docx$/i, "") || "document";
  return `${baseName}${outputMode === "bilingual" ? "-Bilingual" : "-English"}.docx`;
}
