// Client-only module. Do not import from API routes.

import type { ChatMessage } from "@/lib/ai/types";

export class ChatClientError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ChatClientError";
    this.statusCode = statusCode;
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  return error instanceof Error && error.name === "AbortError";
}

async function parseApiError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  let code: string | undefined;

  try {
    const payload = (await response.json()) as {
      error?: string;
      code?: string;
    };
    if (payload.error) {
      message = payload.error;
    }
    code = payload.code;
  } catch {
    // Response body is not JSON; keep default message.
  }

  if (process.env.NODE_ENV !== "production" && code) {
    message = `${message} (${code})`;
  }

  throw new ChatClientError(message, response.status);
}

async function prepareMessagesWithAttachments(
  messages: ChatMessage[],
  files: File[],
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  const formData = new FormData();
  formData.append("messages", JSON.stringify(messages));

  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch("/api/chat/attachments", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    await parseApiError(response, "Failed to process attachments");
  }

  const payload = (await response.json()) as { messages?: ChatMessage[] };

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new ChatClientError("Invalid attachment preparation response", 502);
  }

  return payload.messages;
}

export async function streamChatResponse(
  messages: ChatMessage[],
  options: {
    signal?: AbortSignal;
    files?: File[];
    onChunk: (chunk: string) => void;
  },
): Promise<void> {
  const preparedMessages =
    options.files && options.files.length > 0
      ? await prepareMessagesWithAttachments(
          messages,
          options.files,
          options.signal,
        )
      : messages;

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: preparedMessages }),
    signal: options.signal,
  });

  if (!response.ok) {
    await parseApiError(response, "Failed to send message");
  }

  if (!response.body) {
    throw new ChatClientError("No response stream received", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        options.onChunk(chunk);
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    console.error("[chat/client] Stream read failed:", error);

    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Failed to read response stream";

    throw new ChatClientError(message, 502);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader may already be closed after abort.
    }
  }
}
