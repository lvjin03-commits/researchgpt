import type { ChatConversation } from "@/lib/chat/history";
import type { DisplayChatMessage } from "@/lib/chat/types";
import {
  chatRowsToConversation,
  CloudSyncError,
  mapMessageRow,
  messagesToRows,
  type ChatRow,
} from "@/lib/chat/cloud-types";
import { compactMessagesForPersistence, normalizeDisplayMessages } from "@/lib/chat/message-normalize";
import { createClient } from "@/lib/supabase/client";

export async function getAuthenticatedUserId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new CloudSyncError("Not authenticated", error);
  }

  return user.id;
}

export async function fetchCloudConversations(): Promise<ChatConversation[]> {
  const supabase = createClient();
  const userId = await getAuthenticatedUserId();

  const { data: chats, error: chatsError } = await supabase
    .from("chats")
    .select("id, user_id, title, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (chatsError) {
    throw new CloudSyncError("Failed to load chats", chatsError);
  }

  if (!chats || chats.length === 0) {
    return [];
  }

  const chatIds = chats.map((chat) => chat.id);

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select(
      "id, chat_id, user_id, role, content, attachments, position, created_at",
    )
    .eq("user_id", userId)
    .in("chat_id", chatIds)
    .order("position", { ascending: true });

  if (messagesError) {
    throw new CloudSyncError("Failed to load messages", messagesError);
  }

  const messagesByChatId = new Map<string, ReturnType<typeof mapMessageRow>[]>();

  for (const message of messages ?? []) {
    const mapped = mapMessageRow(message);
    const existing = messagesByChatId.get(mapped.chat_id) ?? [];
    existing.push(mapped);
    messagesByChatId.set(mapped.chat_id, existing);
  }

  const conversations = (chats as ChatRow[]).map((chat) =>
    chatRowsToConversation(chat, messagesByChatId.get(chat.id) ?? []),
  );

  return conversations;
}

export async function createCloudChat(
  conversation: ChatConversation,
): Promise<void> {
  const supabase = createClient();
  const userId = await getAuthenticatedUserId();

  const { error: chatError } = await supabase.from("chats").upsert(
    {
      id: conversation.id,
      user_id: userId,
      title: conversation.title,
    },
    { onConflict: "id" },
  );

  if (chatError) {
    throw new CloudSyncError("Failed to create chat", chatError);
  }

  if (conversation.messages.length > 0) {
    await syncCloudMessages(conversation.id, conversation.messages);
  }
}

export async function migrateLocalConversationsToCloud(
  conversations: ChatConversation[],
): Promise<number> {
  if (conversations.length === 0) {
    return 0;
  }

  let migrated = 0;

  for (const conversation of conversations) {
    await createCloudChat(conversation);
    migrated += 1;
  }

  return migrated;
}

export async function syncCloudMessages(
  chatId: string,
  messages: DisplayChatMessage[],
): Promise<void> {
  const supabase = createClient();
  const userId = await getAuthenticatedUserId();
  const persistedMessages = compactMessagesForPersistence(messages);
  const rows = messagesToRows(chatId, userId, persistedMessages);

  if (rows.length === 0) {
    const { error: deleteError } = await supabase
      .from("messages")
      .delete()
      .eq("chat_id", chatId)
      .eq("user_id", userId);

    if (deleteError) {
      throw new CloudSyncError("Failed to clear messages", deleteError);
    }

    return;
  }

  const { error: upsertError } = await supabase
    .from("messages")
    .upsert(rows, { onConflict: "chat_id,position" });

  if (upsertError) {
    throw new CloudSyncError("Failed to sync messages", upsertError);
  }

  const { error: deleteError } = await supabase
    .from("messages")
    .delete()
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .gte("position", rows.length);

  if (deleteError) {
    throw new CloudSyncError("Failed to prune messages", deleteError);
  }
}

export async function deleteCloudChat(chatId: string): Promise<void> {
  const supabase = createClient();
  const userId = await getAuthenticatedUserId();

  const { error } = await supabase
    .from("chats")
    .delete()
    .eq("id", chatId)
    .eq("user_id", userId);

  if (error) {
    throw new CloudSyncError("Failed to delete chat", error);
  }
}

export async function fetchCloudChatMessages(
  chatId: string,
): Promise<DisplayChatMessage[]> {
  const supabase = createClient();
  const userId = await getAuthenticatedUserId();

  const { data, error } = await supabase
    .from("messages")
    .select("id, chat_id, user_id, role, content, attachments, position, created_at")
    .eq("chat_id", chatId)
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (error) {
    throw new CloudSyncError("Failed to load chat messages", error);
  }

  return normalizeDisplayMessages(
    (data ?? []).map((row) => {
      const mapped = mapMessageRow(row);
      return {
        role: mapped.role,
        content: mapped.content,
        attachments: mapped.attachments ?? undefined,
      };
    }),
  );
}
