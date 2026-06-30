// Shared chat helper safe for /api/chat. Contains no document/export/PDF imports.

import type { ChatMessage, ChatRole } from "@/lib/ai/types";
import type { DisplayAttachment, DisplayChatMessage } from "@/lib/chat/types";

export type ApiTextMessage = {
  role: ChatRole;
  content: string;
};

const UI_ONLY_MESSAGE_KEYS = new Set([
  "id",
  "chat_id",
  "user_id",
  "attachments",
  "position",
  "created_at",
  "updated_at",
  "pending",
  "error",
]);

function isChatRole(value: unknown): value is DisplayChatMessage["role"] {
  return value === "user" || value === "assistant" || value === "system";
}

export function normalizeMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (content == null) {
    return "";
  }

  if (Array.isArray(content)) {
    return content
      .flatMap((part) => {
        if (typeof part !== "object" || part === null) {
          return [];
        }

        const record = part as Record<string, unknown>;

        if (record.type === "text" && typeof record.text === "string") {
          return [record.text];
        }

        return [];
      })
      .join("\n");
  }

  if (typeof content === "object") {
    return "";
  }

  return String(content);
}

export function defaultContentForAttachments(
  attachments: DisplayAttachment[],
): string {
  const imageCount = attachments.filter(
    (attachment) => attachment.kind === "image",
  ).length;
  const documentCount = attachments.filter(
    (attachment) => attachment.kind === "document",
  ).length;

  if (imageCount > 0 && documentCount > 0) {
    return "Please analyze the attached files.";
  }

  if (imageCount > 1) {
    return "Please analyze the attached images.";
  }

  if (imageCount === 1) {
    return "Please analyze the attached image.";
  }

  if (documentCount > 1) {
    return "Please analyze the attached documents.";
  }

  if (documentCount === 1) {
    return "Please analyze the attached document.";
  }

  return "";
}

function hasAttachmentMetadata(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.attachments) && raw.attachments.length > 0;
}

type CoerceRawOptions = {
  index?: number;
  allowAttachmentPlaceholder?: boolean;
};

export function coerceRawToApiMessage(
  raw: unknown,
  options: CoerceRawOptions = {},
): ApiTextMessage | null {
  if (typeof raw !== "object" || raw === null) {
    if (options.index !== undefined) {
      console.error(
        `[api/chat] Invalid message at index ${options.index} (not an object):`,
        raw,
      );
    }
    return null;
  }

  const record = raw as Record<string, unknown>;
  const role = record.role;

  if (!isChatRole(role)) {
    if (options.index !== undefined) {
      console.error(
        `[api/chat] Invalid message at index ${options.index} (bad role):`,
        raw,
      );
    }
    return null;
  }

  const content = normalizeMessageContent(record.content).trim();
  const attachmentOnly =
    role === "user" && !content && hasAttachmentMetadata(record);

  if (attachmentOnly && !options.allowAttachmentPlaceholder) {
    if (options.index !== undefined) {
      console.error(
        `[api/chat] Dropping attachment-only UI message at index ${options.index}:`,
        raw,
      );
    }
    return null;
  }

  if (!content) {
    if (role === "assistant" || role === "system") {
      if (options.index !== undefined) {
        console.error(
          `[api/chat] Dropping empty ${role} message at index ${options.index}:`,
          raw,
        );
      }
      return null;
    }

    if (attachmentOnly && options.allowAttachmentPlaceholder) {
      const attachments = (record.attachments as DisplayAttachment[]).filter(
        (attachment): attachment is DisplayAttachment =>
          typeof attachment?.name === "string" &&
          (attachment.kind === "image" || attachment.kind === "document"),
      );

      const placeholder = defaultContentForAttachments(attachments);
      if (placeholder) {
        return { role, content: placeholder };
      }
    }

    if (options.index !== undefined) {
      console.error(
        `[api/chat] Invalid message at index ${options.index} (empty content):`,
        raw,
      );
    }
    return null;
  }

  for (const key of Object.keys(record)) {
    if (UI_ONLY_MESSAGE_KEYS.has(key)) {
      continue;
    }

    if (key !== "role" && key !== "content") {
      if (options.index !== undefined) {
        console.error(
          `[api/chat] Stripping UI/metadata field "${key}" from message at index ${options.index}`,
        );
      }
    }
  }

  return { role, content };
}

export function sanitizeIncomingChatMessages(rawMessages: unknown): ApiTextMessage[] {
  if (!Array.isArray(rawMessages)) {
    console.error("[api/chat] messages payload is not an array:", rawMessages);
    return [];
  }

  const sanitized: ApiTextMessage[] = [];

  for (const [index, raw] of rawMessages.entries()) {
    const isLast = index === rawMessages.length - 1;
    const apiMessage = coerceRawToApiMessage(raw, {
      index,
      allowAttachmentPlaceholder: isLast,
    });

    if (apiMessage) {
      sanitized.push(apiMessage);
    }
  }

  return ensureLastValidUserMessage(sanitized, rawMessages);
}

function findLastValidUserFromRaw(rawMessages: unknown[]): ApiTextMessage | null {
  for (let index = rawMessages.length - 1; index >= 0; index -= 1) {
    const apiMessage = coerceRawToApiMessage(rawMessages[index], {
      index,
      allowAttachmentPlaceholder: true,
    });

    if (apiMessage?.role === "user" && apiMessage.content.trim()) {
      return apiMessage;
    }
  }

  return null;
}

function ensureLastValidUserMessage(
  sanitized: ApiTextMessage[],
  rawMessages: unknown[],
): ApiTextMessage[] {
  const result = [...sanitized];
  const last = result.at(-1);

  if (last?.role === "user" && last.content.trim()) {
    return result;
  }

  if (last?.role === "user") {
    result.pop();
  }

  while (result.length > 0 && result.at(-1)?.role !== "user") {
    result.pop();
  }

  const trailingUser = result.at(-1);
  if (trailingUser?.role === "user" && trailingUser.content.trim()) {
    return result;
  }

  if (trailingUser) {
    result.pop();
  }

  const fallbackUser = findLastValidUserFromRaw(rawMessages);
  if (fallbackUser) {
    result.push(fallbackUser);
  }

  return result;
}

export function normalizeDisplayMessage(
  message: DisplayChatMessage,
): DisplayChatMessage {
  const role = isChatRole(message.role) ? message.role : "user";
  const content = normalizeMessageContent(message.content);
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.filter(
        (attachment): attachment is DisplayAttachment =>
          typeof attachment?.name === "string" &&
          (attachment.kind === "image" || attachment.kind === "document"),
      )
    : undefined;

  return {
    role,
    content,
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  };
}

export function displayMessageToApiMessage(
  message: DisplayChatMessage,
  options: { allowAttachmentPlaceholder?: boolean } = {},
): ApiTextMessage | null {
  const normalized = normalizeDisplayMessage(message);

  return coerceRawToApiMessage(
    {
      role: normalized.role,
      content: normalized.content,
      attachments: normalized.attachments,
    },
    { allowAttachmentPlaceholder: options.allowAttachmentPlaceholder },
  );
}

export function displayMessagesToApiMessages(
  messages: DisplayChatMessage[],
): ApiTextMessage[] {
  return messages.flatMap((message) => {
    const apiMessage = displayMessageToApiMessage(message);
    return apiMessage ? [apiMessage] : [];
  });
}

export function buildChatApiMessages(
  history: DisplayChatMessage[],
  currentUserMessage: ChatMessage,
): ApiTextMessage[] {
  const historyMessages = displayMessagesToApiMessages(history);
  const current = coerceRawToApiMessage(currentUserMessage, {
    allowAttachmentPlaceholder: true,
  });

  if (!current || current.role !== "user" || !current.content.trim()) {
    return ensureLastValidUserMessage(historyMessages, [
      ...history,
      currentUserMessage,
    ]);
  }

  return [...historyMessages, current];
}

export function compactMessagesForPersistence(
  messages: DisplayChatMessage[],
): DisplayChatMessage[] {
  return messages
    .map(normalizeDisplayMessage)
    .filter((message) => {
      if (message.content.trim().length > 0) {
        return true;
      }

      if (message.role === "user" && message.attachments?.length) {
        return true;
      }

      return false;
    });
}

export function normalizeDisplayMessages(
  messages: DisplayChatMessage[],
): DisplayChatMessage[] {
  return compactMessagesForPersistence(messages);
}
