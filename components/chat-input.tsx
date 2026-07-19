"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { AttachmentPreview } from "@/components/attachment-preview";
import {
  ChevronDownIcon,
  PaperclipIcon,
  SendIcon,
  StopIcon,
} from "@/components/icons";
import {
  CHAT_MODEL_OPTIONS,
  type ChatModelTier,
} from "@/lib/ai/chat-models";
import {
  FOLDER_DRAG_TYPE,
  type ResearchProject,
} from "@/lib/chat/workspace";
import type { LiteratureFolder } from "@/lib/literature/types";
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
  modelTier: ChatModelTier;
  onModelTierChange: (tier: ChatModelTier) => void;
  webSearch: boolean;
  useLibrary: boolean;
  onWebSearchChange: (enabled: boolean) => void;
  onUseLibraryChange: (enabled: boolean) => void;
  memory: string;
  onMemoryChange: (memory: string) => void;
  projects?: ResearchProject[];
  activeProjectId?: string | null;
  onProjectChange?: (projectId: string | null) => void;
  onNewProject?: () => void;
  selectedFolders?: LiteratureFolder[];
  onRemoveFolder?: (folderId: string) => void;
  onFolderDrop?: (folderId: string) => void;
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
  projects = [],
  activeProjectId = null,
  onProjectChange,
  onNewProject,
  selectedFolders = [],
  onRemoveFolder,
  onFolderDrop,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const attachmentsRef = useRef(attachments);

  const selectedModel =
    CHAT_MODEL_OPTIONS.find((option) => option.tier === modelTier) ??
    CHAT_MODEL_OPTIONS[0];
  const inputLocked = disabled || isStreaming;
  const canSend =
    !inputLocked && (message.trim().length > 0 || attachments.length > 0);

  const adjustHeight = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(
      textareaRef.current.scrollHeight,
      MAX_TEXTAREA_HEIGHT,
    )}px`;
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0 || inputLocked) return;
      setAttachments((current) => {
        const result = addPendingAttachments(current, incoming);
        setFileError(result.error);
        return result.attachments;
      });
    },
    [inputLocked],
  );

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      revokePendingAttachmentPreviews(current);
      return [];
    });
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const submit = () => {
    if (!canSend) return;
    onSend({
      message: message.trim(),
      files: attachments.map((attachment) => attachment.file),
    });
    setMessage("");
    clearAttachments();
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    if (inputLocked) return;

    const folderPayload = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
    if (folderPayload) {
      try {
        const parsed = JSON.parse(folderPayload) as { id?: unknown };
        if (typeof parsed.id === "string") {
          onFolderDrop?.(parsed.id);
          return;
        }
      } catch {
        // Fall through to normal file handling.
      }
    }
    addFiles(filesFromDataTransfer(event.dataTransfer));
  };

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeMenu);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      revokePendingAttachmentPreviews(attachmentsRef.current);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent px-4 pb-4 pt-10 sm:px-6 sm:pb-6">
      <form
        className="pointer-events-auto mx-auto w-full max-w-3xl"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="mb-2 flex items-center gap-2">
          <label
            htmlFor="active-research-project"
            className="text-xs font-bold text-gray-600"
          >
            当前项目
          </label>
          <select
            id="active-research-project"
            value={activeProjectId ?? ""}
            onChange={(event) =>
              onProjectChange?.(event.target.value || null)
            }
            disabled={inputLocked}
            className="h-9 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm outline-none focus:border-blue-400 sm:max-w-72"
          >
            <option value="">未选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onNewProject}
            disabled={inputLocked}
            className="h-9 shrink-0 rounded-md bg-gray-900 px-3 text-xs font-bold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            新项目
          </button>
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!inputLocked) setIsDragOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setIsDragOver(false);
          }}
          onDrop={handleDrop}
          className={`relative rounded-2xl border bg-white shadow-[0_2px_24px_rgba(0,0,0,0.07)] transition ${
            isDragOver ? "border-blue-400" : "border-gray-200"
          } focus-within:border-gray-400`}
        >
          {isDragOver && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50/95 text-sm font-bold text-blue-800">
              松开以添加文件或文献文件夹
            </div>
          )}

          {selectedFolders.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5">
              {selectedFolders.map((folder) => (
                <span
                  key={folder.id}
                  className="inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md bg-blue-50 px-2.5 text-xs font-bold text-blue-800"
                >
                  <span className="truncate">{folder.name}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveFolder?.(folder.id)}
                    disabled={inputLocked}
                    aria-label={`移除文件夹 ${folder.name}`}
                    className="shrink-0 text-blue-500 hover:text-blue-900"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <AttachmentPreview
            attachments={attachments}
            disabled={inputLocked}
            onRemove={(id) => {
              setAttachments((current) =>
                removePendingAttachment(current, id),
              );
              setFileError(null);
            }}
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
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={inputLocked}
                aria-label="附加文件"
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
              >
                <PaperclipIcon className="h-5 w-5" />
              </button>

              <div ref={modelMenuRef} className="relative ml-1">
                {modelMenuOpen && (
                  <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
                    <p className="px-3 pb-1.5 pt-1 text-xs font-semibold text-gray-500">
                      选择模型
                    </p>
                    {CHAT_MODEL_OPTIONS.map((option) => (
                      <button
                        key={option.tier}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.tier === modelTier}
                        onClick={() => {
                          onModelTierChange(option.tier);
                          setModelMenuOpen(false);
                        }}
                        className={`w-full rounded-lg px-3 py-2.5 text-left hover:bg-gray-50 ${
                          option.tier === modelTier ? "bg-gray-100" : ""
                        }`}
                      >
                        <span className="block text-sm font-bold text-gray-900">
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                          {option.description}
                        </span>
                      </button>
                    ))}
                    <div className="mt-1 border-t border-gray-100 px-2 py-2">
                      <label className="block text-xs font-bold text-gray-600">
                        科研偏好记忆
                      </label>
                      <textarea
                        value={memory}
                        onChange={(event) =>
                          onMemoryChange(event.target.value)
                        }
                        maxLength={2000}
                        rows={3}
                        placeholder="例如：材料化学；默认中文；使用 GB/T 7714"
                        className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 px-2.5 py-2 text-xs leading-5 outline-none focus:border-gray-400"
                      />
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setModelMenuOpen((open) => !open)}
                  disabled={inputLocked}
                  aria-haspopup="menu"
                  aria-expanded={modelMenuOpen}
                  className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold text-gray-700 hover:bg-gray-100"
                >
                  {selectedModel.label}
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                type="button"
                aria-pressed={webSearch}
                onClick={() => onWebSearchChange(!webSearch)}
                disabled={inputLocked}
                title="允许 AI 在需要最新信息时搜索网络"
                className={`ml-1 h-9 rounded-lg px-2.5 text-xs font-bold ${
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
                title="从文献库标题、摘要和 PDF 全文中检索证据"
                className={`ml-1 h-9 rounded-lg px-2.5 text-xs font-bold ${
                  useLibrary
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                文献库
              </button>
            </div>

            <label htmlFor="chat-input" className="sr-only">
              输入科研任务
            </label>
            <textarea
              id="chat-input"
              ref={textareaRef}
              rows={1}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                adjustHeight();
              }}
              onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
                if (inputLocked) return;
                const pastedFiles = filesFromClipboard(event.clipboardData);
                if (pastedFiles.length > 0) {
                  event.preventDefault();
                  addFiles(pastedFiles);
                }
              }}
              placeholder="描述任务，或拖入文献文件夹…"
              disabled={disabled}
              className="max-h-[200px] min-h-[52px] flex-1 resize-none bg-transparent py-4 pr-2 text-[15px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-60"
            />

            <div className="flex shrink-0 items-center self-end p-2">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="停止生成"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-800"
                >
                  <StopIcon className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label="发送消息"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400"
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
          请核实重要科研信息。图片最大 {MAX_IMAGE_UPLOAD_MB}MB，文档最大{" "}
          {MAX_UPLOAD_MB}MB。
        </p>
      </form>
    </div>
  );
}
