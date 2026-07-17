"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ArrowDown } from "lucide-react";
import { ChatMessageBubble } from "@/components/chat-message";
import type { DisplayChatMessage } from "@/lib/chat/types";

type ChatMessagesProps = {
  messages: DisplayChatMessage[];
  chatTitle: string;
  isStreaming: boolean;
  error: string | null;
  activity: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  onEditMessage: (index: number) => void;
  onRetryMessage: (index: number) => void;
};

export function ChatMessages({
  messages,
  chatTitle,
  isStreaming,
  error,
  activity,
  scrollContainerRef,
  onEditMessage,
  onRetryMessage,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const previousMessageCountRef = useRef(messages.length);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const lastMessageLength = messages.at(-1)?.content.length ?? 0;

  const updateFollowState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom < 96;

    shouldFollowRef.current = isNearBottom;
    setShowJumpToBottom(!isNearBottom);
  }, [scrollContainerRef]);

  const jumpToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      shouldFollowRef.current = true;
      setShowJumpToBottom(false);
      bottomRef.current?.scrollIntoView({ behavior, block: "end" });
    },
    [],
  );

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    updateFollowState();
    container.addEventListener("scroll", updateFollowState, { passive: true });

    return () => {
      container.removeEventListener("scroll", updateFollowState);
    };
  }, [scrollContainerRef, updateFollowState]);

  useEffect(() => {
    const hasNewMessage = messages.length > previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;

    if (hasNewMessage && messages.at(-1)?.role === "user") {
      jumpToBottom("smooth");
      return;
    }

    if (shouldFollowRef.current) {
      jumpToBottom(isStreaming ? "auto" : "smooth");
    }
  }, [
    error,
    isStreaming,
    jumpToBottom,
    lastMessageLength,
    messages,
    messages.length,
  ]);

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      {messages.map((message, index) => (
        <ChatMessageBubble
          key={`${message.role}-${index}-${message.content.slice(0, 24)}-${message.attachments?.map((attachment) => attachment.name).join("|") ?? ""}`}
          message={message}
          chatTitle={chatTitle}
          onEdit={message.role === "user" ? () => onEditMessage(index) : undefined}
          onRetry={message.role === "assistant" ? () => onRetryMessage(index) : undefined}
        />
      ))}

      {isStreaming &&
        messages.at(-1)?.role === "assistant" &&
        messages.at(-1)?.content === "" && (
          <div className="flex justify-start" aria-label="正在生成回答">
            <div className="px-1 py-3">
              <span className="inline-flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
              </span>
            </div>
          </div>
        )}

      {isStreaming && activity && (
        <div className="flex items-center gap-2 text-sm font-medium text-gray-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
          {activity}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div ref={bottomRef} />

      {showJumpToBottom && (
        <button
          type="button"
          onClick={() => jumpToBottom()}
          className="fixed bottom-32 left-1/2 z-30 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-md transition hover:bg-gray-50 hover:text-gray-950 sm:bottom-36"
          aria-label="回到最新回答"
          title="回到最新回答"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
