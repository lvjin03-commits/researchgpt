"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createConversation,
  loadChatHistory,
  saveChatHistory,
  removeConversation,
  upsertConversation,
  type ChatConversation,
} from "@/lib/chat/history";
import {
  createCloudChat,
  deleteCloudChat,
  fetchCloudConversations,
  getAuthenticatedUserId,
  migrateLocalConversationsToCloud,
  syncCloudMessages,
} from "@/lib/chat/cloud-sync";
import type { DisplayChatMessage } from "@/lib/chat/types";

const CLOUD_SYNC_DEBOUNCE_MS = 800;

type UseChatHistoryResult = {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  activeMessages: DisplayChatMessage[];
  isHydrated: boolean;
  isCloudSynced: boolean;
  syncError: string | null;
  startNewChat: () => void;
  selectConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  persistConversation: (
    conversationId: string,
    messages: DisplayChatMessage[],
  ) => void;
  ensureActiveConversation: (
    messages: DisplayChatMessage[],
  ) => Promise<string>;
  flushCloudSync: () => Promise<void>;
};

function persistLocalFallback(
  conversations: ChatConversation[],
  activeConversationId: string | null,
  userId: string | null,
): void {
  saveChatHistory({ conversations, activeConversationId }, userId);
}

function resolveActiveConversationId(
  conversations: ChatConversation[],
  preferredId: string | null,
): string | null {
  if (
    preferredId &&
    conversations.some((conversation) => conversation.id === preferredId)
  ) {
    return preferredId;
  }

  return null;
}

export function useChatHistory(): UseChatHistoryResult {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [activeMessages, setActiveMessages] = useState<DisplayChatMessage[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isCloudSynced, setIsCloudSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const userIdRef = useRef<string | null>(null);
  const skipNextLocalPersistRef = useRef(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<ChatConversation[]>([]);
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCloudSyncRef = useRef<{
    chatId: string;
    messages: DisplayChatMessage[];
  } | null>(null);
  const pendingChatCreatesRef = useRef<Map<string, Promise<void>>>(new Map());
  const cloudEnabledRef = useRef(true);

  activeConversationIdRef.current = activeConversationId;
  conversationsRef.current = conversations;

  const markCloudFailure = useCallback((error: unknown) => {
    console.error("[chat-history] Cloud sync failed:", error);
    cloudEnabledRef.current = false;
    setIsCloudSynced(false);
    setSyncError("Cloud sync unavailable. Using local cache.");
  }, []);

  const markCloudSuccess = useCallback(() => {
    cloudEnabledRef.current = true;
    setIsCloudSynced(true);
    setSyncError(null);
  }, []);

  const waitForChatCreation = useCallback(async (chatId: string) => {
    const pendingCreate = pendingChatCreatesRef.current.get(chatId);
    if (pendingCreate) {
      await pendingCreate;
    }
  }, []);

  const flushCloudSync = useCallback(async () => {
    const pending = pendingCloudSyncRef.current;

    if (!pending || !cloudEnabledRef.current) {
      return;
    }

    pendingCloudSyncRef.current = null;

    if (cloudSyncTimerRef.current) {
      clearTimeout(cloudSyncTimerRef.current);
      cloudSyncTimerRef.current = null;
    }

    try {
      await waitForChatCreation(pending.chatId);
      await syncCloudMessages(pending.chatId, pending.messages);
      markCloudSuccess();
    } catch (error) {
      markCloudFailure(error);
    }
  }, [markCloudFailure, markCloudSuccess, waitForChatCreation]);

  const scheduleCloudSync = useCallback(
    (chatId: string, messages: DisplayChatMessage[]) => {
      if (!cloudEnabledRef.current) {
        return;
      }

      pendingCloudSyncRef.current = { chatId, messages };

      if (cloudSyncTimerRef.current) {
        clearTimeout(cloudSyncTimerRef.current);
      }

      cloudSyncTimerRef.current = setTimeout(() => {
        void flushCloudSync();
      }, CLOUD_SYNC_DEBOUNCE_MS);
    },
    [flushCloudSync],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const userId = await getAuthenticatedUserId();
        if (cancelled) return;

        userIdRef.current = userId;
        const localStorageData = loadChatHistory(userId);

        let cloudConversations = await fetchCloudConversations();
        if (cancelled) return;

        if (
          cloudConversations.length === 0 &&
          localStorageData.conversations.length > 0
        ) {
          await migrateLocalConversationsToCloud(
            localStorageData.conversations,
          );
          cloudConversations = await fetchCloudConversations();
          if (cancelled) return;
        }

        markCloudSuccess();
        setConversations(cloudConversations);
        conversationsRef.current = cloudConversations;

        const activeId = resolveActiveConversationId(
          cloudConversations,
          localStorageData.activeConversationId,
        );

        setActiveConversationId(activeId);
        activeConversationIdRef.current = activeId;

        if (activeId) {
          const activeConversation = cloudConversations.find(
            (conversation) => conversation.id === activeId,
          );
          setActiveMessages(activeConversation?.messages ?? []);
        } else {
          setActiveMessages([]);
        }

        persistLocalFallback(cloudConversations, activeId, userId);
      } catch (error) {
        console.error("[chat-history] Falling back to localStorage:", error);
        if (cancelled) return;

        cloudEnabledRef.current = false;
        setIsCloudSynced(false);
        setSyncError("Could not load cloud history. Using local cache.");

        const localStorageData = loadChatHistory(userIdRef.current);
        setConversations(localStorageData.conversations);
        conversationsRef.current = localStorageData.conversations;
        setActiveConversationId(localStorageData.activeConversationId);
        activeConversationIdRef.current = localStorageData.activeConversationId;

        if (localStorageData.activeConversationId) {
          const activeConversation = localStorageData.conversations.find(
            (conversation) =>
              conversation.id === localStorageData.activeConversationId,
          );
          setActiveMessages(activeConversation?.messages ?? []);
        } else {
          setActiveMessages([]);
        }
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    void hydrate();

    return () => {
      cancelled = true;
      if (cloudSyncTimerRef.current) {
        clearTimeout(cloudSyncTimerRef.current);
      }
    };
  }, [markCloudSuccess]);

  useEffect(() => {
    if (!isHydrated || skipNextLocalPersistRef.current) {
      skipNextLocalPersistRef.current = false;
      return;
    }

    persistLocalFallback(
      conversations,
      activeConversationId,
      userIdRef.current,
    );
  }, [conversations, activeConversationId, isHydrated]);

  const persistConversation = useCallback(
    (conversationId: string, messages: DisplayChatMessage[]) => {
      setActiveMessages(messages);

      const now = new Date().toISOString();

      setConversations((current) => {
        const existing = current.find(
          (conversation) => conversation.id === conversationId,
        );

        if (!existing) {
          return current;
        }

        const updated = upsertConversation(current, {
          ...existing,
          messages,
          updatedAt: now,
        });

        conversationsRef.current = updated;
        return updated;
      });

      scheduleCloudSync(conversationId, messages);
    },
    [scheduleCloudSync],
  );

  const ensureActiveConversation = useCallback(
    async (messages: DisplayChatMessage[]): Promise<string> => {
      const currentId = activeConversationIdRef.current;

      if (currentId) {
        return currentId;
      }

      const conversation = createConversation(messages);
      activeConversationIdRef.current = conversation.id;

      setConversations((current) => {
        const updated = upsertConversation(current, conversation);
        conversationsRef.current = updated;
        return updated;
      });

      setActiveConversationId(conversation.id);
      setActiveMessages(messages);

      if (cloudEnabledRef.current) {
        const createPromise = createCloudChat(conversation)
          .then(() => {
            markCloudSuccess();
          })
          .catch((error) => {
            markCloudFailure(error);
            throw error;
          })
          .finally(() => {
            pendingChatCreatesRef.current.delete(conversation.id);
          });

        pendingChatCreatesRef.current.set(conversation.id, createPromise);

        try {
          await createPromise;
        } catch {
          // Local cache remains usable even if cloud create fails.
        }
      }

      return conversation.id;
    },
    [markCloudFailure, markCloudSuccess],
  );

  const startNewChat = useCallback(() => {
    skipNextLocalPersistRef.current = false;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setActiveMessages([]);
  }, []);

  const selectConversation = useCallback((conversationId: string) => {
    const conversation = conversationsRef.current.find(
      (entry) => entry.id === conversationId,
    );

    if (!conversation) {
      return;
    }

    skipNextLocalPersistRef.current = true;
    activeConversationIdRef.current = conversation.id;
    setActiveConversationId(conversation.id);
    setActiveMessages(conversation.messages);
  }, []);

  const deleteConversation = useCallback(
    (conversationId: string) => {
      setConversations((current) => {
        const updated = removeConversation(current, conversationId);
        conversationsRef.current = updated;
        return updated;
      });

      if (activeConversationIdRef.current === conversationId) {
        activeConversationIdRef.current = null;
        setActiveConversationId(null);
        setActiveMessages([]);
      }

      pendingChatCreatesRef.current.delete(conversationId);

      if (cloudEnabledRef.current) {
        void deleteCloudChat(conversationId)
          .then(() => {
            markCloudSuccess();
          })
          .catch((error) => {
            markCloudFailure(error);
          });
      }
    },
    [markCloudFailure, markCloudSuccess],
  );

  return {
    conversations,
    activeConversationId,
    activeMessages,
    isHydrated,
    isCloudSynced,
    syncError,
    startNewChat,
    selectConversation,
    deleteConversation,
    persistConversation,
    ensureActiveConversation,
    flushCloudSync,
  };
}
