import {
  buildTranslatedDocumentXml,
  buildTranslatedFilename,
  packTranslatedDocx,
} from "@/lib/translation/docx-build";
import { parseDocxDocument } from "@/lib/translation/docx-parse";
import { createTranslationBatches } from "@/lib/translation/batch";
import { translateBatch } from "@/lib/translation/translate-service";
import { TranslationError } from "@/lib/translation/errors";
import type {
  TranslationProgressEvent,
  TranslationRequestOptions,
} from "@/lib/translation/types";

export async function runDocxTranslationPipeline(
  fileBuffer: Buffer,
  fileName: string,
  options: TranslationRequestOptions,
  onProgress: (event: TranslationProgressEvent) => void,
  signal?: AbortSignal,
): Promise<{
  filename: string;
  buffer: Buffer;
  translatedCount: number;
  skippedCount: number;
}> {
  onProgress({ type: "progress", stage: "uploaded" });
  onProgress({ type: "progress", stage: "extracting" });

  const parsed = parseDocxDocument(fileBuffer, fileName);
  const batches = createTranslationBatches(parsed.paragraphs);
  const translations = new Map<string, string>();

  for (const paragraph of parsed.paragraphs) {
    if (!paragraph.translatable) {
      translations.set(paragraph.id, paragraph.text);
    }
  }

  for (const [batchIndex, batch] of batches.entries()) {
    onProgress({
      type: "progress",
      stage: "translating",
      batch: batchIndex + 1,
      totalBatches: batches.length,
    });

    const batchTranslations = await translateBatch(batch, {
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      style: options.style,
      signal,
    });

    for (const [id, translation] of batchTranslations.entries()) {
      translations.set(id, translation);
    }
  }

  onProgress({ type: "progress", stage: "generating" });

  const translatedDocumentXml = buildTranslatedDocumentXml(
    parsed.documentXml,
    parsed.paragraphs,
    translations,
    options.outputMode,
  );

  const outputBuffer = packTranslatedDocx(
    parsed.zip,
    parsed.documentXmlPath,
    translatedDocumentXml,
  );

  const translatedCount = parsed.paragraphs.filter(
    (paragraph) => paragraph.translatable,
  ).length;
  const skippedCount = parsed.paragraphs.length - translatedCount;

  return {
    filename: buildTranslatedFilename(fileName),
    buffer: outputBuffer,
    translatedCount,
    skippedCount,
  };
}

export function toTranslationError(error: unknown): TranslationError {
  if (error instanceof TranslationError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new TranslationError("Translation cancelled.", 499);
  }

  if (error instanceof Error) {
    return new TranslationError(error.message, 500);
  }

  return new TranslationError("Document translation failed.", 500);
}
