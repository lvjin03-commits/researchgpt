// Server-only module. Do not import from client components or /api/chat route entry.

import OpenAI from "openai";
import { AIProviderError } from "@/lib/ai/errors";
import type { AIProviderAdapter, ChatMessage, StreamChatOptions } from "@/lib/ai/types";
import { messagesIncludeImages } from "@/lib/ai/types";

const DEFAULT_TEXT_MODEL = "gpt-4o-mini";
const DEFAULT_VISION_MODEL = "gpt-4.1-mini";

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
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_TEXT_MODEL;
}

function getVisionModel(): string {
  return process.env.OPENAI_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
}

function getModelForMessages(messages: ChatMessage[]): string {
  if (messagesIncludeImages(messages)) {
    return getVisionModel();
  }

  return getTextModel();
}

function toOpenAIMessages(
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return {
          role: "system",
          content:
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n"),
        };
      case "assistant":
        return {
          role: "assistant",
          content:
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("\n"),
        };
      case "user":
        return {
          role: "user",
          content: message.content,
        };
    }
  });
}

export async function openChatCompletionStream({
  messages,
  signal,
  model: requestedModel,
  reasoningEffort,
}: StreamChatOptions): Promise<
  AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
> {
  const client = getClient();
  const model = requestedModel || getModelForMessages(messages);
  const openaiMessages = toOpenAIMessages(messages);

  console.log(
    "[api/chat] OpenAI chat.completions.create payload:",
    JSON.stringify(
      openaiMessages.map((message) => ({
        role: message.role,
        content:
          message.role === "user" && Array.isArray(message.content)
            ? message.content.map((part) => {
                if (part.type === "text") {
                  return { type: "text", text: part.text };
                }
                if (part.type === "image_url") {
                  const url = part.image_url.url;
                  return {
                    type: "image_url",
                    image_url: {
                      url:
                        url.length > 80
                          ? `${url.slice(0, 80)}… (${url.length} chars)`
                          : url,
                      detail: part.image_url.detail,
                    },
                  };
                }
                return part;
              })
            : message.content,
      })),
    ),
  );

  console.log("[api/chat] OpenAI chat.completions.create model:", model);

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        messages: openaiMessages,
        stream: true,
        ...(reasoningEffort
          ? { reasoning_effort: reasoningEffort }
          : {}),
      },
      { signal },
    );

    return logStreamResponseModel(stream);
  } catch (error) {
    throw toProviderError(error);
  }
}

async function* logStreamResponseModel(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  let loggedResponseModel = false;

  for await (const chunk of stream) {
    if (!loggedResponseModel && chunk.model) {
      console.log(
        "[api/chat] OpenAI chat.completions.create response.model:",
        chunk.model,
      );
      loggedResponseModel = true;
    }

    yield chunk;
  }
}

export const openaiProvider: AIProviderAdapter = {
  name: "openai",

  async *streamChat(options: StreamChatOptions) {
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    try {
      stream = await openChatCompletionStream(options);
    } catch (error) {
      throw toProviderError(error);
    }

    try {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          yield text;
        }
      }
    } catch (error) {
      throw toProviderError(error);
    }
  },
};

function toProviderError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) {
    return error;
  }

  if (error instanceof OpenAI.APIError) {
    return new AIProviderError(error.message, {
      statusCode: error.status ?? 502,
      provider: "openai",
      cause: error,
    });
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new AIProviderError("Request cancelled", {
      statusCode: 499,
      provider: "openai",
      cause: error,
    });
  }

  return new AIProviderError("OpenAI request failed", {
    statusCode: 502,
    provider: "openai",
    cause: error,
  });
}
