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

export async function streamChatResponse(
  messages: ChatMessage[],
  options: {
    signal?: AbortSignal;
    files?: File[];
    onChunk: (chunk: string) => void;
  },
): Promise<void> {
  let response: Response;

  if (options.files && options.files.length > 0) {
    const formData = new FormData();
    formData.append("messages", JSON.stringify(messages));

    for (const file of options.files) {
      formData.append("files", file);
    }

    response = await fetch("/api/chat", {
      method: "POST",
      body: formData,
      signal: options.signal,
    });
  } else {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: options.signal,
    });
  }

  if (!response.ok) {
    let message = "Failed to send message";

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Response body is not JSON; keep default message.
    }

    throw new ChatClientError(message, response.status);
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
