import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/errors";
import {
  buildTranslationSystemPrompt,
  buildTranslationUserPrompt,
} from "@/lib/translation/prompts";
import { TranslationError } from "@/lib/translation/errors";
import type {
  SourceLanguage,
  TargetLanguage,
  TranslationBatchItem,
  TranslationStyle,
} from "@/lib/translation/types";

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new AIProviderError("OPENAI_API_KEY is not configured", {
      statusCode: 500,
      provider: "openai",
    });
  }

  return new OpenAI({ apiKey });
}

function getTextModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

type TranslationResponseItem = {
  id: string;
  translation: string;
};

function parseTranslationResponse(
  content: string,
  batch: TranslationBatchItem[],
): Map<string, string> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new TranslationError(
      "The translation provider returned an invalid response.",
      502,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new TranslationError(
      "The translation provider returned an invalid response format.",
      502,
    );
  }

  const results = new Map<string, string>();

  for (const entry of parsed) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as TranslationResponseItem).id !== "string" ||
      typeof (entry as TranslationResponseItem).translation !== "string"
    ) {
      continue;
    }

    const item = entry as TranslationResponseItem;
    results.set(item.id, item.translation.trim());
  }

  for (const item of batch) {
    if (!results.has(item.id)) {
      results.set(item.id, item.text);
    }
  }

  return results;
}

export async function translateBatch(
  batch: TranslationBatchItem[],
  options: {
    sourceLanguage: SourceLanguage;
    targetLanguage: TargetLanguage;
    style: TranslationStyle;
    signal?: AbortSignal;
  },
): Promise<Map<string, string>> {
  if (batch.length === 0) {
    return new Map();
  }

  const client = getClient();
  const model = getTextModel();

  try {
    console.log("[translate] OpenAI chat.completions.create model:", model);

    const completion = await client.chat.completions.create(
      {
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${buildTranslationSystemPrompt(options)}\nReturn JSON as {"items":[{"id":"...","translation":"..."}]}.`,
          },
          {
            role: "user",
            content: buildTranslationUserPrompt(batch),
          },
        ],
      },
      { signal: options.signal },
    );

    console.log(
      "[translate] OpenAI chat.completions.create response.model:",
      completion.model,
    );

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new TranslationError(
        "The translation provider returned an empty response.",
        502,
      );
    }

    let payload: unknown;

    try {
      payload = JSON.parse(content);
    } catch {
      throw new TranslationError(
        "The translation provider returned invalid JSON.",
        502,
      );
    }

    const items = Array.isArray(payload)
      ? payload
      : typeof payload === "object" &&
          payload !== null &&
          Array.isArray((payload as { items?: unknown }).items)
        ? (payload as { items: unknown[] }).items
        : null;

    if (!items) {
      throw new TranslationError(
        "The translation provider returned an unexpected JSON shape.",
        502,
      );
    }

    return parseTranslationResponse(JSON.stringify(items), batch);
  } catch (error) {
    if (error instanceof TranslationError || error instanceof AIProviderError) {
      throw error;
    }

    if (error instanceof OpenAI.APIError) {
      throw new TranslationError(error.message, error.status ?? 502);
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw new TranslationError("Translation request failed.", 502);
  }
}
