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

type AttachmentErrorPayload = {
  error?: string;
  details?: string;
  fileName?: string;
  fileType?: string;
  stage?: string;
  code?: string;
};

async function parseApiError(
  response: Response,
  fallback: string,
  responseBodyText?: string,
): Promise<never> {
  let message = fallback;
  let code: string | undefined;
  let payload: AttachmentErrorPayload | undefined;

  if (responseBodyText !== undefined) {
    try {
      payload = JSON.parse(responseBodyText) as AttachmentErrorPayload;
    } catch {
      // Body is not JSON; keep default message.
    }
  } else {
    try {
      payload = (await response.json()) as AttachmentErrorPayload;
    } catch {
      // Response body is not JSON; keep default message.
    }
  }

  if (payload?.error) {
    message = payload.error;
  }

  if (payload?.details) {
    message = `${message}: ${payload.details}`;
    if (payload.fileName || payload.stage) {
      console.error("[upload-debug] attachment error context", {
        fileName: payload.fileName,
        fileType: payload.fileType,
        stage: payload.stage,
        details: payload.details,
      });
    }
  }

  code = payload?.code;

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
  for (const file of files) {
    console.log("[upload-debug] selected file", {
      name: file.name,
      type: file.type || "(empty)",
      size: file.size,
    });
  }

  console.log("[upload-debug] calling /api/chat/attachments");

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

  const responseBodyText = await response.text();

  console.log("[upload-debug] attachments response status", response.status);
  console.log("[upload-debug] attachments response body", responseBodyText);

  if (!response.ok) {
    await parseApiError(
      response,
      "Failed to process attachments",
      responseBodyText,
    );
  }

  let payload: { messages?: ChatMessage[] };

  try {
    payload = JSON.parse(responseBodyText) as { messages?: ChatMessage[] };
  } catch {
    throw new ChatClientError("Invalid attachment preparation response", 502);
  }

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
  const hasFiles = Boolean(options.files && options.files.length > 0);

  if (!hasFiles) {
    console.log(
      "[upload-debug] flow stopped before attachments: no files on send (text-only path to /api/chat)",
    );
  }

  const preparedMessages = hasFiles
    ? await prepareMessagesWithAttachments(
        messages,
        options.files!,
        options.signal,
      )
    : messages;

  console.log("[upload-debug] calling /api/chat");

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: preparedMessages }),
    signal: options.signal,
  });

  console.log("[upload-debug] chat response status", response.status);

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
