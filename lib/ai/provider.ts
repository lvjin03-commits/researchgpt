// Server-only module. Do not import from client components or /api/chat route entry.

import { AIProviderError } from "@/lib/ai/errors";
import { openaiProvider, openChatCompletionStream } from "@/lib/ai/openai";
import type {
  AIProviderAdapter,
  AIProviderName,
  ChatMessage,
  StreamChatOptions,
} from "@/lib/ai/types";

export type { ChatMessage, ChatRole, StreamChatOptions } from "@/lib/ai/types";
export { AIProviderError };

const PROVIDER_REGISTRY: Record<AIProviderName, AIProviderAdapter> = {
  openai: openaiProvider,
  openrouter: {
    name: "openrouter",
    streamChat: async function* () {
      throw new AIProviderError("OpenRouter provider is not implemented yet", {
        statusCode: 501,
        provider: "openrouter",
      });
    },
  },
};

function parseProviderName(value: string | undefined): AIProviderName {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "openai") {
    return "openai";
  }

  if (normalized === "openrouter") {
    return "openrouter";
  }

  throw new AIProviderError(`Unknown AI provider: ${value}`, {
    statusCode: 500,
  });
}

export function getConfiguredProviderName(): AIProviderName {
  return parseProviderName(process.env.AI_PROVIDER);
}

export function getAIProvider(
  providerName: AIProviderName = getConfiguredProviderName(),
): AIProviderAdapter {
  return PROVIDER_REGISTRY[providerName];
}

export async function* streamChatText(
  options: StreamChatOptions,
  providerName: AIProviderName = getConfiguredProviderName(),
): AsyncGenerator<string, void, undefined> {
  const provider = getAIProvider(providerName);
  yield* provider.streamChat(options);
}

export function createChatStream(
  options: StreamChatOptions,
  providerName: AIProviderName = getConfiguredProviderName(),
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  options.signal?.addEventListener(
    "abort",
    () => abortController.abort(),
    { once: true },
  );

  const streamOptions: StreamChatOptions = {
    ...options,
    signal: abortController.signal,
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamChatText(streamOptions, providerName)) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (error) {
        controller.error(normalizeStreamError(error, providerName));
      }
    },
    cancel() {
      abortController.abort();
    },
  });
}

export async function createConnectedChatStream(
  options: StreamChatOptions,
  providerName: AIProviderName = getConfiguredProviderName(),
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  const abortController = new AbortController();

  options.signal?.addEventListener(
    "abort",
    () => abortController.abort(),
    { once: true },
  );

  const streamOptions: StreamChatOptions = {
    ...options,
    signal: abortController.signal,
  };

  if (providerName === "openai") {
    const openaiStream = await openChatCompletionStream(streamOptions);

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of openaiStream) {
            const text = chunk.choices[0]?.delta?.content;
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          controller.close();
        } catch (error) {
          controller.error(normalizeStreamError(error, providerName));
        }
      },
      cancel() {
        abortController.abort();
      },
    });
  }

  return createChatStream(streamOptions, providerName);
}

function normalizeStreamError(
  error: unknown,
  providerName: AIProviderName,
): AIProviderError {
  if (error instanceof AIProviderError) {
    return error;
  }

  return new AIProviderError("Failed to stream chat response", {
    statusCode: 502,
    provider: providerName,
    cause: error,
  });
}

export function validateChatMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AIProviderError("messages must be a non-empty array", {
      statusCode: 400,
    });
  }

  const validated: ChatMessage[] = [];

  for (const [index, message] of messages.entries()) {
    if (
      typeof message !== "object" ||
      message === null ||
      !("role" in message) ||
      !("content" in message)
    ) {
      throw new AIProviderError(`Invalid message at index ${index}`, {
        statusCode: 400,
      });
    }

    const { role, content } = message as { role: unknown; content: unknown };

    if (role !== "user" && role !== "assistant" && role !== "system") {
      throw new AIProviderError(`Invalid role at index ${index}`, {
        statusCode: 400,
      });
    }

    if (typeof content !== "string" || content.trim().length === 0) {
      throw new AIProviderError(`Invalid content at index ${index}`, {
        statusCode: 400,
      });
    }

    validated.push({ role, content: content.trim() });
  }

  const lastMessage = validated.at(-1);
  if (lastMessage?.role !== "user") {
    throw new AIProviderError("The last message must be from the user", {
      statusCode: 400,
    });
  }

  return validated;
}
