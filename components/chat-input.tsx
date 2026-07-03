"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AttachmentPreview } from "@/components/attachment-preview";
import { PaperclipIcon, SendIcon, StopIcon } from "@/components/icons";
import {
  ACCEPTED_FILE_TYPES,
  MAX_IMAGE_UPLOAD_MB,
  MAX_UPLOAD_MB,
} from "@/lib/uploads/constants";
import {
  addPendingAttachments,
  filesFromClipboard,
  filesFromDataTransfer,
  removePendingAttachment,
  revokePendingAttachmentPreviews,
  type PendingAttachment,
} from "@/lib/uploads/client-attachments";

const MAX_TEXTAREA_HEIGHT = 200;

export type ChatSendPayload = {
  message: string;
  files?: File[];
};

type ChatInputProps = {
  onSend: (payload: ChatSendPayload) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
};

export function ChatInput({
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0 || disabled || isStreaming) return;

    setAttachments((current) => {
      const { attachments: next, error } = addPendingAttachments(
        current,
        incoming,
      );

      setFileError(error);
      return next;
    });
  }, [disabled, isStreaming]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((current) => removePendingAttachment(current, id));
    setFileError(null);
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(event.target.value);
    adjustHeight();
  };

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      revokePendingAttachmentPreviews(current);
      return [];
    });
    setFileError(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleSubmit = () => {
    if (isStreaming) return;

    const trimmed = message.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;

    onSend({
      message: trimmed,
      files: attachments.map((attachment) => attachment.file),
    });

    setMessage("");
    clearAttachments();

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled || isStreaming) return;

    const pastedFiles = filesFromClipboard(event.clipboardData);

    if (pastedFiles.length === 0) {
      return;
    }

    event.preventDefault();
    addFiles(pastedFiles);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!disabled) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    if (disabled || isStreaming) return;

    addFiles(filesFromDataTransfer(event.dataTransfer));
  };

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    return () => {
      revokePendingAttachmentPreviews(attachmentsRef.current);
    };
  }, []);

  const canSend =
    !isStreaming &&
    (message.trim().length > 0 || attachments.length > 0) &&
    !disabled;

  const inputLocked = disabled || isStreaming;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-4 pt-10 sm:px-6 sm:pb-6">
      <form
        className="pointer-events-auto mx-auto w-full max-w-3xl"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-3xl border bg-white shadow-[0_2px_24px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.03] transition-shadow focus-within:border-gray-300 focus-within:shadow-[0_4px_32px_rgba(0,0,0,0.08)] ${
            isDragOver
              ? "border-gray-400 ring-gray-200"
              : "border-gray-200"
          }`}
        >
          {isDragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 rounded-3xl border-2 border-dashed border-gray-300 bg-gray-50/80" />
          )}

          <AttachmentPreview
            attachments={attachments}
            disabled={inputLocked}
            onRemove={handleRemoveAttachment}
          />

          <div className="flex items-end">
            <div className="flex shrink-0 items-center self-end p-2 pl-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                multiple
                className="sr-only"
                disabled={inputLocked}
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={inputLocked}
                aria-label="附加文件"
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <PaperclipIcon className="h-5 w-5" />
              </button>
            </div>

            <label htmlFor="chat-input" className="sr-only">
              研究提示
            </label>
            <textarea
              id="chat-input"
              ref={textareaRef}
              rows={1}
              value={message}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="输入消息……"
              disabled={disabled}
              className="max-h-[200px] min-h-[52px] flex-1 resize-none bg-transparent py-4 pr-2 text-[15px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />

            <div className="flex shrink-0 items-center self-end p-2">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="停止生成"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white transition-all hover:bg-gray-800"
                >
                  <StopIcon className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label="发送消息"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white transition-all hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                >
                  <SendIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {fileError && (
          <p className="mt-2 text-center text-xs text-red-500">{fileError}</p>
        )}

        <p className="mt-2 text-center text-xs text-gray-400">
          ResearchGPT 可能会出错，请核实重要信息。图片最大 {MAX_IMAGE_UPLOAD_MB}MB，文档最大{" "}
          {MAX_UPLOAD_MB}MB。
        </p>
      </form>
    </div>
  );
}
