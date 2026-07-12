import { createClient } from "@/lib/supabase/server";
import {
  runDocxTranslationPipeline,
  toTranslationError,
} from "@/lib/translation/pipeline";
import type {
  OutputMode,
  SourceLanguage,
  TargetLanguage,
  TranslationProgressEvent,
  TranslationStyle,
} from "@/lib/translation/types";

export const runtime = "nodejs";
export const maxDuration = 300;

function isSourceLanguage(value: string): value is SourceLanguage {
  return value === "chinese";
}

function isTargetLanguage(value: string): value is TargetLanguage {
  return value === "english";
}

function isOutputMode(value: string): value is OutputMode {
  return value === "replace" || value === "bilingual";
}

function isTranslationStyle(value: string): value is TranslationStyle {
  return (
    value === "academic" ||
    value === "sci-paper" ||
    value === "technical" ||
    value === "general"
  );
}

function encodeEvent(event: TranslationProgressEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function POST(request: Request) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TranslationProgressEvent) => {
        controller.enqueue(encodeEvent(event));
      };

      try {
        const user = await requireUser();

        if (!user) {
          emit({
            type: "error",
            message: "You must be signed in to translate documents.",
          });
          controller.close();
          return;
        }

        const formData = await request.formData();
        const file = formData.get("file");
        const sourceLanguage = String(formData.get("sourceLanguage") ?? "chinese");
        const targetLanguage = String(formData.get("targetLanguage") ?? "english");
        const outputMode = String(formData.get("outputMode") ?? "replace");
        const style = String(formData.get("style") ?? "academic");
        const glossary = String(formData.get("glossary") ?? "").trim();

        if (!(file instanceof File)) {
          emit({ type: "error", message: "Please upload a .docx file." });
          controller.close();
          return;
        }

        if (!isSourceLanguage(sourceLanguage)) {
          emit({ type: "error", message: "Invalid source language." });
          controller.close();
          return;
        }

        if (!isTargetLanguage(targetLanguage)) {
          emit({ type: "error", message: "Invalid target language." });
          controller.close();
          return;
        }

        if (!isOutputMode(outputMode)) {
          emit({ type: "error", message: "Invalid output mode." });
          controller.close();
          return;
        }

        if (!isTranslationStyle(style)) {
          emit({ type: "error", message: "Invalid translation style." });
          controller.close();
          return;
        }

        if (glossary.length > 10_000) {
          emit({ type: "error", message: "术语表不能超过 10,000 个字符。" });
          controller.close();
          return;
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await runDocxTranslationPipeline(
          buffer,
          file.name,
          {
            sourceLanguage,
            targetLanguage,
            outputMode,
            style,
            glossary: glossary || undefined,
          },
          emit,
          request.signal,
        );

        emit({
          type: "complete",
          filename: result.filename,
          fileBase64: result.buffer.toString("base64"),
          translatedCount: result.translatedCount,
          skippedCount: result.skippedCount,
          qualityWarnings: result.qualityWarnings,
        });
        controller.close();
      } catch (error) {
        const translationError = toTranslationError(error);
        emit({ type: "error", message: translationError.message });
        controller.close();
      }
    },
    cancel() {
      // Request abort propagates through request.signal.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
