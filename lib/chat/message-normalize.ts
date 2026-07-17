// Shared chat helper safe for /api/chat. Contains no document/export/PDF imports.

import type {
  ChatMessage,
  ChatRole,
  MessageContent,
  MessageContentPart,
} from "@/lib/ai/types";
import type { DisplayAttachment, DisplayChatMessage } from "@/lib/chat/types";

export type ApiTextMessage = {
  role: ChatRole;
  content: MessageContent;
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

function coerceContentParts(
  rawParts: unknown[],
  role: ChatRole,
): MessageContentPart[] {
  const parts: MessageContentPart[] = [];

  for (const part of rawParts) {
    if (typeof part !== "object" || part === null) {
      continue;
    }

    const record = part as Record<string, unknown>;

    if (record.type === "text" && typeof record.text === "string") {
      parts.push({ type: "text", text: record.text });
      continue;
    }

    if (
      role === "user" &&
      record.type === "image_url" &&
      typeof record.image_url === "object" &&
      record.image_url !== null
    ) {
      const imageUrl = record.image_url as Record<string, unknown>;
      const url = imageUrl.url;

      if (typeof url === "string" && url.trim().length > 0) {
        const detail = imageUrl.detail;
        parts.push({
          type: "image_url",
          image_url: {
            url: url.trim(),
            ...(detail === "auto" || detail === "low" || detail === "high"
              ? { detail }
              : {}),
          },
        });
      }
    }
  }

  return parts;
}

function finalizeMessageContent(content: MessageContent): MessageContent {
  if (typeof content === "string") {
    return content.trim();
  }

  const parts: MessageContentPart[] = [];

  for (const part of content) {
    if (part.type === "text") {
      const text = part.text.trim();
      if (text) {
        parts.push({ type: "text", text });
      }
      continue;
    }

    if (part.type === "image_url") {
      const url = part.image_url.url.trim();
      if (url) {
        parts.push({
          type: "image_url",
          image_url: {
            url,
            ...(part.image_url.detail ? { detail: part.image_url.detail } : {}),
          },
        });
      }
    }
  }

  if (parts.some((part) => part.type === "image_url")) {
    return parts;
  }

  if (parts.length === 1 && parts[0]?.type === "text") {
    return parts[0].text;
  }

  return parts
    .filter((part): part is Extract<MessageContentPart, { type: "text" }> =>
      part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function messageContentIsNonEmpty(
  content: MessageContent,
  role: ChatRole,
): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }

  const hasText = content.some(
    (part) => part.type === "text" && part.text.trim().length > 0,
  );

  if (role === "user") {
    const hasImage = content.some(
      (part) =>
        part.type === "image_url" && part.image_url.url.trim().length > 0,
    );
    return hasText || hasImage;
  }

  return hasText;
}

function coerceRawMessageContent(
  rawContent: unknown,
  role: ChatRole,
): MessageContent | null {
  if (typeof rawContent === "string") {
    const trimmed = rawContent.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (rawContent == null) {
    return null;
  }

  if (Array.isArray(rawContent)) {
    const parts = coerceContentParts(rawContent, role);
    if (parts.length === 0) {
      return null;
    }

    const finalized = finalizeMessageContent(parts);
    return messageContentIsNonEmpty(finalized, role) ? finalized : null;
  }

  if (typeof rawContent === "object") {
    return null;
  }

  const asString = String(rawContent).trim();
  return asString.length > 0 ? asString : null;
}

function apiMessageHasValidContent(message: ApiTextMessage): boolean {
  return messageContentIsNonEmpty(message.content, message.role);
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
    return "请分析附件。";
  }

  if (imageCount > 1) {
    return "请分析附件图片。";
  }

  if (imageCount === 1) {
    return "请分析附件图片。";
  }

  if (documentCount > 1) {
    return "请分析附件文档。";
  }

  if (documentCount === 1) {
    return "请分析附件文档。";
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

  const coercedContent = coerceRawMessageContent(record.content, role);
  const textPreview =
    coercedContent === null
      ? ""
      : typeof coercedContent === "string"
        ? coercedContent
        : normalizeMessageContent(coercedContent);
  const attachmentOnly =
    role === "user" && !textPreview.trim() && hasAttachmentMetadata(record);

  if (attachmentOnly && !options.allowAttachmentPlaceholder) {
    if (options.index !== undefined) {
      console.error(
        `[api/chat] Dropping attachment-only UI message at index ${options.index}:`,
        raw,
      );
    }
    return null;
  }

  if (!coercedContent || !messageContentIsNonEmpty(coercedContent, role)) {
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

  return {
    role,
    content:
      typeof coercedContent === "string"
        ? coercedContent.trim()
        : finalizeMessageContent(coercedContent),
  };
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

    if (apiMessage?.role === "user" && apiMessageHasValidContent(apiMessage)) {
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

  if (last?.role === "user" && apiMessageHasValidContent(last)) {
    return result;
  }

  if (last?.role === "user") {
    result.pop();
  }

  while (result.length > 0 && result.at(-1)?.role !== "user") {
    result.pop();
  }

  const trailingUser = result.at(-1);
  if (trailingUser?.role === "user" && apiMessageHasValidContent(trailingUser)) {
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
      ).map((attachment) => ({
        ...attachment,
        context:
          typeof attachment.context === "string"
            ? attachment.context.slice(0, 30000)
            : undefined,
      }))
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
  const attachmentContext = Array.from(
    new Set(
      normalized.attachments
        ?.map((attachment) => attachment.context?.trim())
        .filter((context): context is string => Boolean(context)) ?? [],
    ),
  ).join("\n\n");

  return coerceRawToApiMessage(
    {
      role: normalized.role,
      content: attachmentContext
        ? `${normalized.content}\n\n[已解析附件内容]\n${attachmentContext}`
        : normalized.content,
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

  if (!current || current.role !== "user" || !apiMessageHasValidContent(current)) {
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
