import { normalizeDisplayMessages } from "@/lib/chat/message-normalize";
import type { AttachmentKind } from "@/lib/uploads/constants";
import { normalizeMessageContent } from "@/lib/chat/message-normalize";
import type { ChatConversation } from "@/lib/chat/history";
import type { DisplayAttachment, DisplayChatMessage } from "@/lib/chat/types";
import type { Json } from "@/lib/supabase/database.types";

export type ChatRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments: DisplayAttachment[] | null;
  position: number;
  created_at: string;
};

export type MessageRowInsert = {
  chat_id: string;
  user_id: string;
  role: DisplayChatMessage["role"];
  content: string;
  attachments?: DisplayAttachment[] | null;
  position: number;
};

function parseAttachments(value: Json | null): DisplayAttachment[] | null {
  if (!value || !Array.isArray(value)) {
    return null;
  }

  const attachments = value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const record = entry as Record<string, unknown>;

    if (
      typeof record.name !== "string" ||
      (record.kind !== "image" && record.kind !== "document")
    ) {
      return [];
    }

    return [{
      name: record.name,
      kind: record.kind as AttachmentKind,
      context:
        typeof record.context === "string" ? record.context : undefined,
    }];
  });

  return attachments.length > 0 ? attachments : null;
}

export function messageRowToDisplay(row: MessageRow): DisplayChatMessage {
  return {
    role: row.role,
    content: normalizeMessageContent(row.content),
    attachments: row.attachments ?? undefined,
  };
}

export function chatRowsToConversation(
  chat: ChatRow,
  messageRows: MessageRow[],
): ChatConversation {
  const messages = [...messageRows]
    .sort((left, right) => left.position - right.position)
    .map(messageRowToDisplay);

  return {
    id: chat.id,
    title: chat.title,
    messages: normalizeDisplayMessages(messages),
    createdAt: chat.created_at,
    updatedAt: chat.updated_at,
  };
}

export function messagesToRows(
  chatId: string,
  userId: string,
  messages: DisplayChatMessage[],
): MessageRowInsert[] {
  return messages.map((message, position) => ({
    chat_id: chatId,
    user_id: userId,
    role: message.role,
    content: message.content,
    attachments: message.attachments ?? null,
    position,
  }));
}

export function mapMessageRow(row: {
  id: string;
  chat_id: string;
  user_id: string;
  role: string;
  content: string;
  attachments: Json | null;
  position: number;
  created_at: string;
}): MessageRow {
  const role =
    row.role === "user" || row.role === "assistant" || row.role === "system"
      ? row.role
      : "user";

  return {
    id: row.id,
    chat_id: row.chat_id,
    user_id: row.user_id,
    role,
    content: normalizeMessageContent(row.content),
    attachments: parseAttachments(row.attachments),
    position: row.position,
    created_at: row.created_at,
  };
}

export class CloudSyncError extends Error {
  readonly causeDetails?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "CloudSyncError";
    this.causeDetails = cause;
  }
}
