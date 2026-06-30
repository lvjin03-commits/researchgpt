import {
  BATCH_MAX_CHARS,
  BATCH_MAX_ITEMS,
} from "@/lib/translation/constants";
import type { DocxParagraphUnit, TranslationBatchItem } from "@/lib/translation/types";

export function createTranslationBatches(
  paragraphs: DocxParagraphUnit[],
): TranslationBatchItem[][] {
  const translatable = paragraphs.filter((paragraph) => paragraph.translatable);
  const batches: TranslationBatchItem[][] = [];
  let currentBatch: TranslationBatchItem[] = [];
  let currentChars = 0;

  for (const paragraph of translatable) {
    const item = { id: paragraph.id, text: paragraph.text };
    const itemLength = paragraph.text.length;

    const exceedsItems = currentBatch.length >= BATCH_MAX_ITEMS;
    const exceedsChars =
      currentBatch.length > 0 && currentChars + itemLength > BATCH_MAX_CHARS;

    if (exceedsItems || exceedsChars) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(item);
    currentChars += itemLength;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}
