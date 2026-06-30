import { MessageExportMenu } from "@/components/message-export-menu";
import type { DisplayChatMessage } from "@/lib/chat/types";
import { DocumentIcon, ImageIcon } from "@/components/icons";

type ChatMessageProps = {
  message: DisplayChatMessage;
  chatTitle: string;
};

export function ChatMessageBubble({ message, chatTitle }: ChatMessageProps) {
  const isUser = message.role === "user";
  const canExport =
    message.role === "assistant" && message.content.trim().length > 0;

  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[85%] sm:max-w-[75%] ${isUser ? "" : "flex flex-col items-start"}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-[15px] leading-relaxed ${
            isUser
              ? "bg-gray-900 text-white"
              : "bg-gray-100 text-gray-900"
          }`}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.attachments.map((attachment, attachmentIndex) => {
                const AttachmentIcon =
                  attachment.kind === "image" ? ImageIcon : DocumentIcon;

                return (
                  <div
                    key={`${attachment.name}-${attachmentIndex}`}
                    className={`inline-flex max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${
                      isUser
                        ? "bg-white/10 text-gray-100"
                        : "bg-white text-gray-600"
                    }`}
                  >
                    <AttachmentIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{attachment.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          {message.content && (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
        </div>

        {canExport && (
          <MessageExportMenu content={message.content} chatTitle={chatTitle} />
        )}
      </div>
    </div>
  );
}
