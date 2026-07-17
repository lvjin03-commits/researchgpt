"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatInput, type ChatSendPayload } from "@/components/chat-input";
import { ChatMessages } from "@/components/chat-messages";
import { MenuIcon } from "@/components/icons";
import { Sidebar } from "@/components/sidebar";
import type { ChatMessage } from "@/lib/ai/types";
import {
  DEFAULT_CHAT_MODEL_TIER,
  isChatModelTier,
  type ChatModelTier,
} from "@/lib/ai/chat-models";
import { ChatClientError, isAbortError, streamChatResponse } from "@/lib/chat/client";
import {
  defaultContentForAttachments,
  buildChatApiMessages,
} from "@/lib/chat/message-normalize";
import type { DisplayAttachment, DisplayChatMessage } from "@/lib/chat/types";
import { useChatHistory } from "@/lib/chat/use-chat-history";
import { createClient } from "@/lib/supabase/client";
import { getAttachmentKind } from "@/lib/uploads/constants";

function toApiUserMessage(payload: ChatSendPayload): ChatMessage {
  const trimmed = payload.message.trim();

  if (trimmed) {
    return { role: "user", content: trimmed };
  }

  if (payload.files && payload.files.length > 0) {
    const attachments = toDisplayAttachments(payload.files);
    return {
      role: "user",
      content: defaultContentForAttachments(attachments),
    };
  }

  return { role: "user", content: trimmed };
}

function toDisplayAttachments(files: File[]): DisplayAttachment[] {
  return files.flatMap((file) => {
    const kind = getAttachmentKind(file.name);
    if (!kind) return [];
    return [{ name: file.name, kind }];
  });
}

function toDisplayUserMessage(payload: ChatSendPayload): DisplayChatMessage {
  return {
    role: "user",
    content: payload.message.trim(),
    attachments: payload.files ? toDisplayAttachments(payload.files) : undefined,
  };
}

export function ChatShell() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [usage, setUsage] = useState({ input: 0, output: 0, total: 0 });
  const [webSearch, setWebSearch] = useState(true);
  const [useLibrary, setUseLibrary] = useState(false);
  const [memory, setMemory] = useState("");
  const [modelTier, setModelTier] = useState<ChatModelTier>(
    DEFAULT_CHAT_MODEL_TIER,
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedTier = window.localStorage.getItem("researchgpt-chat-model-tier");
      if (isChatModelTier(savedTier)) {
        setModelTier(savedTier);
      }
      setWebSearch(window.localStorage.getItem("researchgpt-chat-web") !== "false");
      setUseLibrary(window.localStorage.getItem("researchgpt-chat-library") === "true");
      setMemory(window.localStorage.getItem("researchgpt-chat-memory") ?? "");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleModelTierChange = useCallback((tier: ChatModelTier) => {
    setModelTier(tier);
    window.localStorage.setItem("researchgpt-chat-model-tier", tier);
  }, []);

  const handleWebSearchChange = useCallback((enabled: boolean) => {
    setWebSearch(enabled);
    window.localStorage.setItem("researchgpt-chat-web", String(enabled));
  }, []);

  const handleUseLibraryChange = useCallback((enabled: boolean) => {
    setUseLibrary(enabled);
    window.localStorage.setItem("researchgpt-chat-library", String(enabled));
  }, []);

  const handleMemoryChange = useCallback((value: string) => {
    setMemory(value);
    window.localStorage.setItem("researchgpt-chat-memory", value);
  }, []);

  const {
    conversations,
    activeConversationId,
    activeMessages,
    isHydrated,
    syncError,
    startNewChat,
    selectConversation,
    deleteConversation,
    persistConversation,
    ensureActiveConversation,
    flushCloudSync,
  } = useChatHistory();

  const abortActiveStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handleNewChat = useCallback(() => {
    abortActiveStream();
    setError(null);
    startNewChat();
  }, [abortActiveStream, startNewChat]);

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      abortActiveStream();
      setError(null);
      setIsStreaming(false);
      selectConversation(conversationId);
    },
    [abortActiveStream, selectConversation],
  );

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      abortActiveStream();
      setError(null);
      setIsStreaming(false);
      deleteConversation(conversationId);
    },
    [abortActiveStream, deleteConversation],
  );

  const handleLogout = useCallback(async () => {
    abortActiveStream();
    setIsLoggingOut(true);
    setError(null);

    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/auth");
      router.refresh();
    } catch {
      setError("退出登录失败，请重试。");
      setIsLoggingOut(false);
    }
  }, [abortActiveStream, router]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const submitMessage = useCallback(
    async (payload: ChatSendPayload, history: DisplayChatMessage[] = activeMessages) => {
      abortControllerRef.current?.abort();

      const displayUserMessage = toDisplayUserMessage(payload);
      const assistantMessage: DisplayChatMessage = {
        role: "assistant",
        content: "",
      };

      const nextMessages: DisplayChatMessage[] = [
        ...history,
        displayUserMessage,
        assistantMessage,
      ];

      const conversationId = await ensureActiveConversation(nextMessages);
      persistConversation(conversationId, nextMessages);

      const apiMessages = buildChatApiMessages(
        history,
        toApiUserMessage(payload),
      );

      setError(null);
      setActivity("正在准备回答");
      setIsStreaming(true);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let streamingMessages = nextMessages;

      try {
        await streamChatResponse(apiMessages, {
          files: payload.files,
          signal: abortController.signal,
          modelTier,
          webSearch,
          useLibrary,
          memory,
          onStatus: setActivity,
          onUsage: (nextUsage) =>
            setUsage((current) => ({
              input: current.input + nextUsage.inputTokens,
              output: current.output + nextUsage.outputTokens,
              total: current.total + nextUsage.totalTokens,
            })),
          onAttachmentsPrepared: (context) => {
            streamingMessages = streamingMessages.map((message, index) => {
              if (index !== history.length || message.role !== "user") {
                return message;
              }
              return {
                ...message,
                attachments: message.attachments?.map((attachment) => ({
                  ...attachment,
                  context,
                })),
              };
            });
            persistConversation(conversationId, streamingMessages);
          },
          onChunk: (chunk) => {
            streamingMessages = streamingMessages.map((message, index) => {
              if (
                index !== streamingMessages.length - 1 ||
                message.role !== "assistant"
              ) {
                return message;
              }

              return {
                ...message,
                content: message.content + chunk,
              };
            });

            persistConversation(conversationId, streamingMessages);
          },
        });
      } catch (err) {
        if (isAbortError(err)) {
          const lastMessage = streamingMessages.at(-1);
          if (
            lastMessage?.role === "assistant" &&
            lastMessage.content.trim().length === 0
          ) {
            const trimmedMessages = streamingMessages.slice(0, -1);
            persistConversation(conversationId, trimmedMessages);
          }
          return;
        }

        const message =
          err instanceof ChatClientError
            ? err.message
            : "出现错误，请重试。";

        setError(message);
      } finally {
        setIsStreaming(false);
        setActivity(null);
        abortControllerRef.current = null;
        await flushCloudSync();
      }
    },
    [
      activeMessages,
      ensureActiveConversation,
      persistConversation,
      flushCloudSync,
      modelTier,
      webSearch,
      useLibrary,
      memory,
    ],
  );

  const handleSend = useCallback(
    (payload: ChatSendPayload) => submitMessage(payload),
    [submitMessage],
  );

  const handleEditMessage = useCallback(
    (index: number) => {
      const message = activeMessages[index];
      if (!message || message.role !== "user") return;
      const edited = window.prompt("编辑消息", message.content);
      if (!edited?.trim()) return;
      void submitMessage({ message: edited.trim() }, activeMessages.slice(0, index));
    },
    [activeMessages, submitMessage],
  );

  const handleRetryMessage = useCallback(
    (index: number) => {
      const userMessage = activeMessages[index - 1];
      if (!userMessage || userMessage.role !== "user") return;
      void submitMessage(
        { message: userMessage.content },
        activeMessages.slice(0, index - 1),
      );
    },
    [activeMessages, submitMessage],
  );

  const hasMessages = activeMessages.length > 0;
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const chatTitle = activeConversation?.title ?? "新建对话";

  if (!isHydrated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-white">
        <p className="text-sm text-gray-400">正在加载对话…</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-white">
      <Sidebar
        isOpen={sidebarOpen}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
        syncError={syncError}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100"
            aria-label="打开侧栏"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold text-gray-900">
            ResearchGPT
          </span>
        </header>

        <main className="relative flex flex-1 flex-col overflow-hidden">
          {hasMessages ? (
            <div
              ref={messageScrollRef}
              className="flex-1 overflow-y-auto pb-36 sm:pb-40"
            >
              <ChatMessages
                messages={activeMessages}
                chatTitle={chatTitle}
                isStreaming={isStreaming}
                error={error}
                activity={activity}
                scrollContainerRef={messageScrollRef}
                onEditMessage={handleEditMessage}
                onRetryMessage={handleRetryMessage}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-4 pb-36 sm:px-6 sm:pb-40">
              <div className="max-w-2xl text-center">
                <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">
                  ResearchGPT
                </h1>
                <p className="mt-3 text-lg text-gray-500 sm:text-xl">
                  今天想研究什么？
                </p>
                {error && (
                  <p className="mt-4 text-sm text-red-600">{error}</p>
                )}
              </div>
            </div>
          )}

          <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            isStreaming={isStreaming}
            modelTier={modelTier}
            onModelTierChange={handleModelTierChange}
            webSearch={webSearch}
            useLibrary={useLibrary}
            onWebSearchChange={handleWebSearchChange}
            onUseLibraryChange={handleUseLibraryChange}
            memory={memory}
            onMemoryChange={handleMemoryChange}
          />
          {usage.total > 0 && (
            <div className="pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2 text-[10px] text-gray-400">
              本次会话约 {usage.total.toLocaleString()} tokens
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
