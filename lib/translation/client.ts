// Client-only module. Do not import from API routes.

import { downloadBlob } from "@/lib/export/download";
import type { TranslationProgressEvent } from "@/lib/translation/types";
import type {
  OutputMode,
  SourceLanguage,
  TargetLanguage,
  TranslationStyle,
} from "@/lib/translation/types";

export class TranslationClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationClientError";
  }
}

export type TranslationFormValues = {
  file: File;
  sourceLanguage: SourceLanguage;
  targetLanguage: TargetLanguage;
  outputMode: OutputMode;
  style: TranslationStyle;
  glossary?: string;
};

export type TranslationUiState = {
  stage:
    | "idle"
    | "uploaded"
    | "extracting"
    | "translating"
    | "generating"
    | "completed";
  batch?: number;
  totalBatches?: number;
  error?: string;
  filename?: string;
  translatedCount?: number;
  skippedCount?: number;
  qualityWarnings?: string[];
};

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

export async function translateDocxFile(
  values: TranslationFormValues,
  options: {
    signal?: AbortSignal;
    onProgress: (state: TranslationUiState) => void;
  },
): Promise<void> {
  const formData = new FormData();
  formData.append("file", values.file);
  formData.append("sourceLanguage", values.sourceLanguage);
  formData.append("targetLanguage", values.targetLanguage);
  formData.append("outputMode", values.outputMode);
  formData.append("style", values.style);
  formData.append("glossary", values.glossary ?? "");

  options.onProgress({ stage: "uploaded" });

  const response = await fetch("/api/translate/docx", {
    method: "POST",
    body: formData,
    signal: options.signal,
  });

  if (!response.ok) {
    let message = "文档翻译失败。";

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Keep default message.
    }

    throw new TranslationClientError(message);
  }

  if (!response.body) {
    throw new TranslationClientError("未返回翻译流。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      const event = JSON.parse(line) as TranslationProgressEvent;

      if (event.type === "progress") {
        if (event.stage === "translating") {
          options.onProgress({
            stage: event.stage,
            batch: event.batch,
            totalBatches: event.totalBatches,
          });
        } else {
          options.onProgress({ stage: event.stage });
        }
        continue;
      }

      if (event.type === "error") {
        throw new TranslationClientError(event.message);
      }

      if (event.type === "complete") {
        options.onProgress({
          stage: "completed",
          filename: event.filename,
          translatedCount: event.translatedCount,
          skippedCount: event.skippedCount,
          qualityWarnings: event.qualityWarnings,
        });

        downloadBlob(
          base64ToBlob(
            event.fileBase64,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          ),
          event.filename,
        );
        return;
      }
    }
  }

  throw new TranslationClientError("翻译意外中断，未完成。");
}
