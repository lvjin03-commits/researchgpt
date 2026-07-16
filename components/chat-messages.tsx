"use client";

import { useEffect, useRef } from "react";
import { ChatMessageBubble } from "@/components/chat-message";
import type { DisplayChatMessage } from "@/lib/chat/types";

type ChatMessagesProps = {
  messages: DisplayChatMessage[];
  chatTitle: string;
  isStreaming: boolean;
  error: string | null;
  activity: string | null;
  onEditMessage: (index: number) => void;
  onRetryMessage: (index: number) => void;
};

export function ChatMessages({
  messages,
  chatTitle,
  isStreaming,
  error,
  activity,
  onEditMessage,
  onRetryMessage,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, error]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
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
          <div className="flex justify-start">
            <div className="rounded-2xl bg-gray-100 px-4 py-3">
              <span className="inline-flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
              </span>
            </div>
          </div>
        )}

      {isStreaming && activity && (
        <div className="text-sm font-medium text-gray-500">{activity}</div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
