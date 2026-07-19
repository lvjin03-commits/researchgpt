"use client";

import {
  BookOpen,
  FileUp,
  GripVertical,
  LoaderCircle,
  PanelRightClose,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { PAPER_DRAG_TYPE } from "@/lib/chat/workspace";
import type {
  LiteratureFolder,
  LiteraturePaper,
} from "@/lib/literature/types";

type ResearchToolPanelProps = {
  open: boolean;
  folder: LiteratureFolder | null;
  papers: LiteraturePaper[];
  isStreaming: boolean;
  activity: string | null;
  busyPaperId?: string | null;
  isUploading?: boolean;
  operationMessage?: string | null;
  operationError?: string | null;
  onRemovePaper: (paper: LiteraturePaper) => void;
  onUploadFiles: (files: File[]) => void;
  onClose: () => void;
};

function pdfState(paper: LiteraturePaper): string {
  if (paper.pdfDownloadStatus === "stored") return "PDF 全文";
  if (paper.abstract) return "标题与摘要";
  return "待补全文";
}

export function ResearchToolPanel({
  open,
  folder,
  papers,
  isStreaming,
  activity,
  busyPaperId = null,
  isUploading = false,
  operationMessage = null,
  operationError = null,
  onRemovePaper,
  onUploadFiles,
  onClose,
}: ResearchToolPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  if (!open) return null;

  const acceptFiles = (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLocaleLowerCase().endsWith(".pdf"),
    );
    if (pdfs.length > 0) onUploadFiles(pdfs);
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(460px,94vw)] flex-col border-l border-gray-200 bg-white shadow-2xl lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:shadow-none xl:w-[440px]">
      <header className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-blue-700" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-950">
              {folder ? folder.name : "当前任务"}
            </p>
            <p className="text-xs text-gray-500">
              {folder ? `${papers.length} 篇文献` : "执行过程与工具状态"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {folder && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(event) => {
                  if (event.target.files) acceptFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={isUploading}
                title="上传 PDF 到当前文件夹"
                aria-label="上传 PDF 到当前文件夹"
                className="inline-flex h-8 w-8 items-center justify-center text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                {isUploading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="收起功能工作台"
            title="收起"
            className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-100"
          >
            <PanelRightClose className="hidden h-4 w-4 lg:block" />
            <X className="h-4 w-4 lg:hidden" />
          </button>
        </div>
      </header>

      <div
        className={`flex-1 overflow-y-auto transition-colors ${
          dragActive ? "bg-blue-50" : ""
        }`}
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragActive(true);
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          if (!folder || !event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragActive(false);
          acceptFiles(event.dataTransfer.files);
        }}
      >
        {dragActive && folder && (
          <div className="pointer-events-none absolute inset-y-14 right-0 z-20 flex w-[min(460px,94vw)] items-center justify-center border-2 border-dashed border-blue-500 bg-blue-50/95 lg:w-[380px] xl:w-[440px]">
            <div className="text-center">
              <FileUp className="mx-auto h-8 w-8 text-blue-700" />
              <p className="mt-3 text-sm font-bold text-blue-950">
                上传到“{folder.name}”
              </p>
            </div>
          </div>
        )}

        {isStreaming && (
          <section className="border-b border-gray-200 bg-blue-50 px-4 py-3">
            <p className="flex items-center gap-2 text-xs font-bold text-blue-900">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              AI 正在执行
            </p>
            <p className="mt-1 text-sm leading-6 text-blue-800">
              {activity || "正在分析任务并组织结果"}
            </p>
          </section>
        )}

        {operationMessage && (
          <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800">
            {operationMessage}
          </p>
        )}
        {operationError && (
          <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700">
            {operationError}
          </p>
        )}

        {folder ? (
          <section className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-950">文件夹内容</h2>
              <a
                href={`/literature/library?folderId=${encodeURIComponent(folder.id)}`}
                className="text-xs font-bold text-blue-700 hover:text-blue-900"
              >
                管理文献
              </a>
            </div>
            {papers.length === 0 ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="w-full border border-dashed border-gray-300 px-4 py-10 text-center hover:border-blue-400 hover:bg-blue-50"
              >
                <FileUp className="mx-auto h-5 w-5 text-blue-700" />
                <span className="mt-2 block text-sm font-semibold text-gray-700">
                  上传或拖入本地 PDF
                </span>
              </button>
            ) : (
              <ul className="divide-y divide-gray-100 border-y border-gray-200">
                {papers.slice(0, 100).map((paper) => (
                  <li
                    key={paper.id}
                    draggable={busyPaperId !== paper.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        PAPER_DRAG_TYPE,
                        JSON.stringify({ id: paper.id, title: paper.title }),
                      );
                    }}
                    className="group flex gap-2 py-3"
                  >
                    <GripVertical
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-gray-300 group-hover:text-gray-500"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <a
                        href={`/literature/papers/${paper.id}`}
                        className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900 hover:text-blue-700"
                      >
                        {paper.title}
                      </a>
                      <p className="mt-1 truncate text-xs text-gray-500">
                        {paper.authors.slice(0, 3).join("、") || "作者未知"}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
                        <span>{paper.publishedAt?.slice(0, 4) || "年份未知"}</span>
                        <span>{pdfState(paper)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemovePaper(paper)}
                      disabled={busyPaperId === paper.id}
                      title="移出当前文件夹"
                      aria-label={`将 ${paper.title} 移出当前文件夹`}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-gray-400 opacity-100 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                    >
                      {busyPaperId === paper.id ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section className="p-4">
            <div className="border border-dashed border-gray-300 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-gray-700">
                功能工作台会在这里打开
              </p>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
