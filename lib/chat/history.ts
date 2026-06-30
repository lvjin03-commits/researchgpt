// Client-only module. Do not import from API routes.

import type { DisplayChatMessage } from "@/lib/chat/types";
import { normalizeDisplayMessage } from "@/lib/chat/message-normalize";

export type ChatConversation = {
  id: string;
  title: string;
  messages: DisplayChatMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ChatHistoryStorage = {
  conversations: ChatConversation[];
  activeConversationId: string | null;
};

export const CHAT_HISTORY_STORAGE_KEY = "researchgpt-chat-history-v1";

export const LEGACY_CHAT_HISTORY_STORAGE_KEY = CHAT_HISTORY_STORAGE_KEY;

export function getChatHistoryStorageKey(userId?: string | null): string {
  if (userId) {
    return `${CHAT_HISTORY_STORAGE_KEY}:${userId}`;
  }

  return `${CHAT_HISTORY_STORAGE_KEY}:anonymous`;
}

function readStorageKey(storageKey: string): ChatHistoryStorage {
  if (typeof window === "undefined") {
    return { conversations: [], activeConversationId: null };
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return { conversations: [], activeConversationId: null };
    }

    return parseChatHistoryStorage(JSON.parse(raw));
  } catch {
    return { conversations: [], activeConversationId: null };
  }
}

export const MAX_TITLE_LENGTH = 48;

export function createConversationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function generateChatTitle(firstUserMessage: DisplayChatMessage): string {
  const trimmedContent = firstUserMessage.content.trim();

  if (trimmedContent) {
    return truncateTitle(trimmedContent);
  }

  const firstAttachment = firstUserMessage.attachments?.[0];

  if (firstAttachment) {
    const prefix = firstAttachment.kind === "image" ? "Image" : "Document";
    return truncateTitle(`${prefix}: ${firstAttachment.name}`);
  }

  return "New chat";
}

function truncateTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= MAX_TITLE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export function createConversation(
  messages: DisplayChatMessage[],
): ChatConversation {
  const now = new Date().toISOString();
  const firstUserMessage = messages.find((message) => message.role === "user");

  return {
    id: createConversationId(),
    title: firstUserMessage ? generateChatTitle(firstUserMessage) : "New chat",
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

export function sortConversationsByUpdated(
  conversations: ChatConversation[],
): ChatConversation[] {
  return [...conversations].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

export function isDisplayChatMessage(value: unknown): value is DisplayChatMessage {
  if (typeof value !== "object" || value === null) return false;

  const message = value as Record<string, unknown>;

  if (
    message.role !== "user" &&
    message.role !== "assistant" &&
    message.role !== "system"
  ) {
    return false;
  }

  return (
    typeof message.content === "string" ||
    message.content == null ||
    typeof message.content === "object"
  );
}

function normalizeStoredConversation(conversation: ChatConversation): ChatConversation {
  return {
    ...conversation,
    messages: conversation.messages.map(normalizeDisplayMessage),
  };
}

export function isChatConversation(value: unknown): value is ChatConversation {
  if (typeof value !== "object" || value === null) return false;

  const conversation = value as Record<string, unknown>;

  return (
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isDisplayChatMessage) &&
    typeof conversation.createdAt === "string" &&
    typeof conversation.updatedAt === "string"
  );
}

export function parseChatHistoryStorage(value: unknown): ChatHistoryStorage {
  if (typeof value !== "object" || value === null) {
    return { conversations: [], activeConversationId: null };
  }

  const storage = value as Record<string, unknown>;
  const conversations = Array.isArray(storage.conversations)
    ? storage.conversations
        .filter(isChatConversation)
        .map(normalizeStoredConversation)
        .map((conversation) => ({
          ...conversation,
          messages: conversation.messages.filter(
            (message) =>
              message.content.trim().length > 0 ||
              (message.role === "user" && Boolean(message.attachments?.length)),
          ),
        }))
    : [];

  const activeConversationId =
    typeof storage.activeConversationId === "string" &&
    conversations.some(
      (conversation) => conversation.id === storage.activeConversationId,
    )
      ? storage.activeConversationId
      : null;

  return {
    conversations: sortConversationsByUpdated(conversations),
    activeConversationId,
  };
}

export function loadChatHistory(userId?: string | null): ChatHistoryStorage {
  const storageKey = getChatHistoryStorageKey(userId);
  const userStorage = readStorageKey(storageKey);

  if (userStorage.conversations.length > 0 || userId) {
    return userStorage;
  }

  const legacyStorage = readStorageKey(LEGACY_CHAT_HISTORY_STORAGE_KEY);

  if (legacyStorage.conversations.length > 0) {
    saveChatHistory(legacyStorage, userId);
  }

  return legacyStorage;
}

export function saveChatHistory(
  storage: ChatHistoryStorage,
  userId?: string | null,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      getChatHistoryStorageKey(userId),
      JSON.stringify({
        conversations: sortConversationsByUpdated(storage.conversations),
        activeConversationId: storage.activeConversationId,
      }),
    );
  } catch (error) {
    console.error("[chat-history] Failed to save:", error);
  }
}

export function clearChatHistoryCache(userId?: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getChatHistoryStorageKey(userId));
}

export function upsertConversation(
  conversations: ChatConversation[],
  conversation: ChatConversation,
): ChatConversation[] {
  const existingIndex = conversations.findIndex(
    (entry) => entry.id === conversation.id,
  );

  if (existingIndex === -1) {
    return sortConversationsByUpdated([conversation, ...conversations]);
  }

  const next = [...conversations];
  next[existingIndex] = conversation;
  return sortConversationsByUpdated(next);
}

export function removeConversation(
  conversations: ChatConversation[],
  conversationId: string,
): ChatConversation[] {
  return conversations.filter((conversation) => conversation.id !== conversationId);
}
