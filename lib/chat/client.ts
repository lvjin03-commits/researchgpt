// Client-only module. Do not import from API routes.

import type { ChatMessage } from "@/lib/ai/types";
import type { ChatModelTier } from "@/lib/ai/chat-models";
import { uploadChatAttachments } from "@/lib/uploads/storage-client";
import type { AttachmentStorageMetadata } from "@/lib/uploads/types";
import type { ChatStreamEvent } from "@/lib/chat/stream-protocol";

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

export type AttachmentPreparationResult = {
  fileName: string;
  status: "ready" | "failed";
  kind?: "document" | "image";
  truncated?: boolean;
  error?: string;
  stage?: string;
};

async function parseApiError(
  response: Response,
  fallback: string,
  responseBodyText?: string,
): Promise<never> {
  let message = fallback;
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
  }

  if (process.env.NODE_ENV !== "production" && payload?.code) {
    message = `${message} (${payload.code})`;
  }

  throw new ChatClientError(message, response.status);
}

async function prepareMessagesWithAttachments(
  messages: ChatMessage[],
  files: File[],
  signal?: AbortSignal,
): Promise<{
  messages: ChatMessage[];
  attachmentContext: string;
  fileResults: AttachmentPreparationResult[];
}> {
  let storageAttachments: AttachmentStorageMetadata[];

  try {
    storageAttachments = await uploadChatAttachments(files);
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "附件上传失败。";
    throw new ChatClientError(message, 502);
  }

  const response = await fetch("/api/chat/attachments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      attachments: storageAttachments,
    }),
    signal,
  });

  const responseBodyText = await response.text();

  if (!response.ok) {
    await parseApiError(
      response,
      "附件处理失败",
      responseBodyText,
    );
  }

  let payload: {
    messages?: ChatMessage[];
    attachmentContext?: string;
    fileResults?: AttachmentPreparationResult[];
  };

  try {
    payload = JSON.parse(responseBodyText) as { messages?: ChatMessage[] };
  } catch {
    throw new ChatClientError("附件预处理响应无效", 502);
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new ChatClientError("附件预处理响应无效", 502);
  }

  return {
    messages: payload.messages,
    attachmentContext:
      typeof payload.attachmentContext === "string"
        ? payload.attachmentContext
        : "",
    fileResults: Array.isArray(payload.fileResults) ? payload.fileResults : [],
  };
}

export async function streamChatResponse(
  messages: ChatMessage[],
  options: {
    signal?: AbortSignal;
    files?: File[];
    modelTier: ChatModelTier;
    webSearch: boolean;
    useLibrary: boolean;
    memory: string;
    onChunk: (chunk: string) => void;
    onStatus?: (message: string) => void;
    onUsage?: (usage: Extract<ChatStreamEvent, { type: "usage" }>) => void;
    onSources?: (
      sources: Extract<ChatStreamEvent, { type: "sources" }>["sources"],
    ) => void;
    onAttachmentsPrepared?: (context: string) => void;
    onAttachmentResults?: (results: AttachmentPreparationResult[]) => void;
  },
): Promise<void> {
  const hasFiles = Boolean(options.files && options.files.length > 0);

  const prepared = hasFiles
    ? await prepareMessagesWithAttachments(
        messages,
        options.files!,
        options.signal,
      )
    : { messages, attachmentContext: "", fileResults: [] };

  if (prepared.attachmentContext) {
    options.onAttachmentsPrepared?.(prepared.attachmentContext);
  }
  if (prepared.fileResults.length > 0) {
    options.onAttachmentResults?.(prepared.fileResults);
  }

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: prepared.messages,
      modelTier: options.modelTier,
      webSearch: options.webSearch,
      useLibrary: options.useLibrary,
      memory: options.memory,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    await parseApiError(response, "发送消息失败");
  }

  if (!response.body) {
    throw new ChatClientError("未收到响应流", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as ChatStreamEvent;
        if (event.type === "text") options.onChunk(event.delta);
        if (event.type === "status") options.onStatus?.(event.message);
        if (event.type === "usage") options.onUsage?.(event);
        if (event.type === "sources") options.onSources?.(event.sources);
        if (event.type === "error") {
          throw new ChatClientError(event.message, 502);
        }
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
        : "读取响应流失败";

    throw new ChatClientError(message, 502);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Reader may already be closed after abort.
    }
  }
}
