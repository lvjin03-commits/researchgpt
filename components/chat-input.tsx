"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AttachmentPreview } from "@/components/attachment-preview";
import {
  ChevronDownIcon,
  PaperclipIcon,
  SendIcon,
  StopIcon,
} from "@/components/icons";
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
import {
  CHAT_MODEL_OPTIONS,
  type ChatModelTier,
} from "@/lib/ai/chat-models";

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
  modelTier: ChatModelTier;
  onModelTierChange: (tier: ChatModelTier) => void;
  webSearch: boolean;
  useLibrary: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  onUseLibraryChange: (enabled: boolean) => void;
  memory: string;
  onMemoryChange: (memory: string) => void;
};

export function ChatInput({
  onSend,
  onStop,
  isStreaming = false,
  disabled = false,
  modelTier,
  onModelTierChange,
  webSearch,
  useLibrary,
  onWebSearchChange,
  onUseLibraryChange,
  memory,
  onMemoryChange,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);

  const selectedModel =
    CHAT_MODEL_OPTIONS.find((option) => option.tier === modelTier) ??
    CHAT_MODEL_OPTIONS[1];

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

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const closeModelMenu = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", closeModelMenu);

    return () => {
      document.removeEventListener("mousedown", closeModelMenu);
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

              <div ref={modelMenuRef} className="relative ml-1">
                {modelMenuOpen && (
                  <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.14)]">
                    <p className="px-3 pb-1.5 pt-1 text-xs font-semibold text-gray-500">
                      选择模型
                    </p>
                    {CHAT_MODEL_OPTIONS.map((option) => {
                      const selected = option.tier === modelTier;

                      return (
                        <button
                          key={option.tier}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          onClick={() => {
                            onModelTierChange(option.tier);
                            setModelMenuOpen(false);
                          }}
                          className={`flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                            selected ? "bg-gray-100" : "hover:bg-gray-50"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-gray-900">
                              {option.label}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                              {option.description}
                            </span>
                          </span>
                          <span className="shrink-0 pt-0.5 text-[11px] font-medium text-gray-400">
                            {option.model}
                          </span>
                        </button>
                      );
                    })}
                    <div className="mt-1 border-t border-gray-100 px-2 py-2">
                      <label className="block text-xs font-semibold text-gray-600">
                        科研偏好记忆
                      </label>
                      <textarea
                        value={memory}
                        onChange={(event) => onMemoryChange(event.target.value)}
                        maxLength={2000}
                        rows={3}
                        placeholder="例如：材料化学；默认中文；使用 GB/T 7714 引用格式"
                        className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 px-2.5 py-2 text-xs leading-5 text-gray-800 outline-none focus:border-gray-400"
                      />
                      <p className="mt-1 text-[11px] text-gray-400">
                        仅保存你明确填写的偏好，不保存对话中的实验数据。
                      </p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setModelMenuOpen((open) => !open)}
                  disabled={inputLocked}
                  aria-haspopup="menu"
                  aria-expanded={modelMenuOpen}
                  className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {selectedModel.label}
                  <ChevronDownIcon
                    className={`h-3.5 w-3.5 transition-transform ${
                      modelMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>

              <button
                type="button"
                aria-pressed={webSearch}
                onClick={() => onWebSearchChange(!webSearch)}
                disabled={inputLocked}
                title="允许模型在需要最新信息时搜索网络"
                className={`ml-1 h-9 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                  webSearch
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                联网
              </button>
              <button
                type="button"
                aria-pressed={useLibrary}
                onClick={() => onUseLibraryChange(!useLibrary)}
                disabled={inputLocked}
                title="从你的文献库标题、摘要和PDF全文中检索证据"
                className={`ml-1 h-9 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                  useLibrary
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                文献库
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
