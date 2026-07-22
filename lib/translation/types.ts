import type { ChatModelTier } from "@/lib/ai/chat-models";

export type SourceLanguage = "auto" | "chinese" | "english";

export type TargetLanguage = "chinese" | "english";

export type OutputMode = "replace" | "bilingual";

export type TranslationStyle =
  | "academic"
  | "sci-paper"
  | "technical"
  | "general";

export type TranslationStage =
  | "uploaded"
  | "extracting"
  | "translating"
  | "generating"
  | "completed"
  | "error";

export type TranslationProgressEvent =
  | { type: "progress"; stage: "uploaded" }
  | { type: "progress"; stage: "extracting" }
  | {
      type: "progress";
      stage: "translating";
      batch: number;
      totalBatches: number;
    }
  | { type: "progress"; stage: "generating" }
  | {
      type: "complete";
      filename: string;
      fileBase64: string;
      translatedCount: number;
      skippedCount: number;
      qualityWarnings: string[];
    }
  | { type: "error"; message: string };

export type TranslationRequestOptions = {
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
  outputMode: OutputMode;
  style: TranslationStyle;
  modelTier: ChatModelTier;
  glossary?: string;
};

export type DocxParagraphUnit = {
  id: string;
  xml: string;
  text: string;
  startIndex: number;
  endIndex: number;
  translatable: boolean;
  skipReason?: string;
};

export type TranslationBatchItem = {
  id: string;
  text: string;
};
