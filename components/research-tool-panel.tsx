"use client";

import {
  BookOpen,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileUp,
  FolderOpen,
  GripVertical,
  Languages,
  LoaderCircle,
  PanelRightClose,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  PAPER_DRAG_TYPE,
  type ResearchProject,
} from "@/lib/chat/workspace";
import type {
  LocalFolderBinding,
  LocalPdfFile,
} from "@/lib/desktop/connection";
import type {
  LiteratureFolder,
  LiteraturePaper,
} from "@/lib/literature/types";

type ResearchToolPanelProps = {
  open: boolean;
  folder: LiteratureFolder | null;
  project?: ResearchProject | null;
  cloudFolders?: LiteratureFolder[];
  papers: LiteraturePaper[];
  selectedLocalFileIds?: string[];
  isStreaming: boolean;
  activity: string | null;
  busyPaperId?: string | null;
  isUploading?: boolean;
  operationMessage?: string | null;
  operationError?: string | null;
  localPdfStatus?: string | null;
  activeLocalPdfAction?: string | null;
  onOpenLocalPdf?: (file: LocalPdfFile) => void;
  onReadLocalPdf?: (file: LocalPdfFile) => void;
  onToggleLocalFile?: (fileId: string) => void;
  onToggleLocalFolder?: (folder: LocalFolderBinding) => void;
  onClearLocalSelection?: () => void;
  onRunLocalFileTask?: (
    action:
      | "single_read"
      | "analysis"
      | "matrix"
      | "translate_en"
      | "translate_bilingual",
    files: LocalPdfFile[],
  ) => void;
  onOpenCloudFolder?: (folder: LiteratureFolder) => void;
  onRemovePaper: (paper: LiteraturePaper) => void;
  onUploadFiles: (files: File[]) => void;
  onClose: () => void;
};

function pdfState(paper: LiteraturePaper): string {
  if (paper.pdfDownloadStatus === "stored") return "PDF 全文";
  if (paper.abstract) return "标题与摘要";
  return "待补全文";
}

function isPdfFile(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.name.toLocaleLowerCase().endsWith(".pdf")
  );
}

export function ResearchToolPanel({
  open,
  folder,
  project = null,
  cloudFolders = [],
  papers,
  selectedLocalFileIds = [],
  isStreaming,
  activity,
  busyPaperId = null,
  isUploading = false,
  operationMessage = null,
  operationError = null,
  localPdfStatus = null,
  activeLocalPdfAction = null,
  onOpenLocalPdf,
  onReadLocalPdf,
  onToggleLocalFile,
  onToggleLocalFolder,
  onClearLocalSelection,
  onRunLocalFileTask,
  onOpenCloudFolder,
  onRemovePaper,
  onUploadFiles,
  onClose,
}: ResearchToolPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | {
        x: number;
        y: number;
        kind: "file";
        file: LocalPdfFile;
      }
    | {
        x: number;
        y: number;
        kind: "folder";
        folder: LocalFolderBinding;
      }
    | null
  >(null);
  const [expandedLocalFolderIds, setExpandedLocalFolderIds] = useState<
    Set<string>
  >(() => new Set());

  const acceptFiles = (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(isPdfFile);
    if (pdfs.length > 0) onUploadFiles(pdfs);
  };

  const selectedLocalFileSet = new Set(selectedLocalFileIds);
  const selectedLocalFiles =
    project?.localFolders
      .flatMap((localFolder) => localFolder.files)
      .filter((file) => selectedLocalFileSet.has(file.id)) ?? [];
  const projectPdfCount =
    project?.localFolders.reduce((total, item) => total + item.pdfCount, 0) ??
    0;
  const showProjectMaterials = !folder && project;

  const toggleExpandedLocalFolder = (folderId: string) => {
    setExpandedLocalFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  if (!open) return null;

  const runTask = (
    action:
      | "single_read"
      | "analysis"
      | "matrix"
      | "translate_en"
      | "translate_bilingual",
    files: LocalPdfFile[],
  ) => {
    setContextMenu(null);
    if (action === "single_read" && files.length !== 1) {
      setActionError("单篇精读必须且只能选择 1 篇 PDF。");
      return;
    }
    if (action === "analysis" && files.length < 1) {
      setActionError("文献分析至少需要选择 1 篇 PDF。");
      return;
    }
    if (action === "matrix" && files.length < 2) {
      setActionError("文献矩阵至少需要选择 2 篇 PDF。");
      return;
    }
    if (
      (action === "translate_en" || action === "translate_bilingual") &&
      files.length < 1
    ) {
      setActionError("文件翻译至少需要选择 1 篇 PDF。");
      return;
    }
    setActionError(null);
    onRunLocalFileTask?.(action, files);
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(460px,94vw)] flex-col border-l border-gray-200 bg-white shadow-2xl lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:shadow-none xl:w-[440px]">
      <header className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-blue-700" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-950">
              {folder ? folder.name : project ? "项目资料" : "当前任务"}
            </p>
            <p className="text-xs text-gray-500">
              {folder
                ? `${papers.length} 篇文献`
                : project
                  ? `${project.localFolders.length} 个本地文件夹 · ${projectPdfCount} 个 PDF`
                  : "执行过程与工具状态"}
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
        {localPdfStatus && (
          <p className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-800">
            {localPdfStatus}
          </p>
        )}
        {actionError && (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
            {actionError}
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
        ) : showProjectMaterials ? (
          <section className="space-y-4 p-4">
            <div className="rounded-lg border border-[#dbe4e7] bg-[#f8fbfc] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#607078]">
                当前项目
              </p>
              <h2 className="mt-1 text-base font-bold text-[#172126]">
                {project.name}
              </h2>
              <p className="mt-1 text-xs leading-5 text-[#607078]">
                默认只读取本项目绑定的资料。勾选 PDF 后，下一次分析会优先只读取已选文件。
              </p>
              {selectedLocalFileIds.length > 0 && (
                <div className="mt-3 rounded-md bg-white px-3 py-2">
                  <div className="flex items-center justify-between text-xs font-bold text-[#174866]">
                    <span>本次已选 {selectedLocalFileIds.length} 个 PDF</span>
                    <button
                      type="button"
                      onClick={onClearLocalSelection}
                      className="text-[#607078] hover:text-[#172126]"
                    >
                      清空选择
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => runTask("single_read", selectedLocalFiles)}
                      disabled={selectedLocalFiles.length !== 1}
                      className="rounded-md border border-[#d4dfe2] px-2 py-1.5 text-[11px] font-bold text-[#174866] hover:bg-[#eef6f9] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      单篇精读
                    </button>
                    <button
                      type="button"
                      onClick={() => runTask("analysis", selectedLocalFiles)}
                      className="rounded-md border border-[#d4dfe2] px-2 py-1.5 text-[11px] font-bold text-[#174866] hover:bg-[#eef6f9]"
                    >
                      文献分析
                    </button>
                    <button
                      type="button"
                      onClick={() => runTask("matrix", selectedLocalFiles)}
                      disabled={selectedLocalFiles.length < 2}
                      className="rounded-md bg-[#174866] px-2 py-1.5 text-[11px] font-bold text-white hover:bg-[#123a52] disabled:cursor-not-allowed disabled:bg-[#b6c9d1]"
                    >
                      文献矩阵
                    </button>
                    <button
                      type="button"
                      onClick={() => runTask("translate_en", selectedLocalFiles)}
                      className="rounded-md border border-[#d4dfe2] px-2 py-1.5 text-[11px] font-bold text-[#174866] hover:bg-[#eef6f9]"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Languages className="h-3 w-3" />
                        译为英文
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runTask("translate_bilingual", selectedLocalFiles)
                      }
                      className="rounded-md border border-[#d4dfe2] px-2 py-1.5 text-[11px] font-bold text-[#174866] hover:bg-[#eef6f9]"
                    >
                      中英双语
                    </button>
                  </div>
                </div>
              )}
            </div>

            {project.localFolders.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-bold text-gray-950">
                  本地文件夹
                </h3>
                <div className="space-y-2">
                  {project.localFolders.map((localFolder) => {
                    const expanded = expandedLocalFolderIds.has(localFolder.id);
                    const folderFileIds = localFolder.files.map((file) => file.id);
                    const selectedCount = folderFileIds.filter((id) =>
                      selectedLocalFileSet.has(id),
                    ).length;
                    const allSelected =
                      folderFileIds.length > 0 &&
                      selectedCount === folderFileIds.length;

                    return (
                      <div
                        key={localFolder.id}
                        className="rounded-lg border border-[#dbe4e7] bg-white"
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            kind: "folder",
                            folder: localFolder,
                          });
                        }}
                      >
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              toggleExpandedLocalFolder(localFolder.id)
                            }
                            className="inline-flex h-7 w-7 items-center justify-center text-[#607078] hover:bg-[#eef3f4]"
                            aria-label={expanded ? "收起文件夹" : "展开文件夹"}
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <FolderOpen className="h-4 w-4 shrink-0 text-[#a56518]" />
                          <button
                            type="button"
                            onClick={() => toggleExpandedLocalFolder(localFolder.id)}
                            onDoubleClick={() =>
                              toggleExpandedLocalFolder(localFolder.id)
                            }
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate text-sm font-bold text-[#26353b]">
                              {localFolder.name}
                            </span>
                            <span className="block truncate text-[11px] text-[#7c8b91]">
                              {localFolder.path}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleLocalFolder?.(localFolder)}
                            className="inline-flex h-8 items-center gap-1 rounded-md border border-[#d4dfe2] px-2 text-[11px] font-bold text-[#174866] hover:bg-[#eef6f9]"
                          >
                            {allSelected ? (
                              <CheckSquare className="h-3.5 w-3.5" />
                            ) : (
                              <Square className="h-3.5 w-3.5" />
                            )}
                            {selectedCount > 0
                              ? `${selectedCount}/${localFolder.files.length}`
                              : "选择"}
                          </button>
                        </div>

                        {expanded && (
                          <ul className="divide-y divide-gray-100 border-t border-[#edf2f4]">
                            {localFolder.files.map((file) => {
                              const selected = selectedLocalFileSet.has(file.id);
                              return (
                                <li
                                  key={file.id}
                                  className={`flex items-center gap-2 px-3 py-2 ${
                                    selected ? "bg-[#eef6f9]" : ""
                                  }`}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setContextMenu({
                                      x: event.clientX,
                                      y: event.clientY,
                                      kind: "file",
                                      file,
                                    });
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={() => onToggleLocalFile?.(file.id)}
                                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center text-[#174866]"
                                    aria-label={
                                      selected ? "取消选择 PDF" : "选择 PDF"
                                    }
                                  >
                                    {selected ? (
                                      <CheckSquare className="h-4 w-4" />
                                    ) : (
                                      <Square className="h-4 w-4" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onToggleLocalFile?.(file.id)}
                                    onDoubleClick={() => onOpenLocalPdf?.(file)}
                                    className="min-w-0 flex-1 text-left"
                                    title={file.path}
                                  >
                                    <span className="block truncate text-sm font-semibold text-[#26353b]">
                                      {file.name}
                                    </span>
                                    <span className="block truncate text-[11px] text-[#7c8b91]">
                                      双击打开 · {(file.size / 1024 / 1024).toFixed(1)} MB
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onOpenLocalPdf?.(file)}
                                    disabled={activeLocalPdfAction === `open:${file.id}`}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#d4dfe2] text-[#174866] hover:bg-[#eef6f9] disabled:opacity-50"
                                    title="打开 PDF"
                                    aria-label={`打开 ${file.name}`}
                                  >
                                    {activeLocalPdfAction === `open:${file.id}` ? (
                                      <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <ExternalLink className="h-4 w-4" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onReadLocalPdf?.(file)}
                                    disabled={activeLocalPdfAction === `read:${file.id}`}
                                    className="inline-flex h-8 shrink-0 items-center rounded-md bg-[#174866] px-2 text-[11px] font-bold text-white hover:bg-[#123a52] disabled:opacity-50"
                                  >
                                    {activeLocalPdfAction === `read:${file.id}`
                                      ? "读取中"
                                      : "测试全文"}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {cloudFolders.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-bold text-gray-950">
                  云端文献夹
                </h3>
                <div className="space-y-2">
                  {cloudFolders.map((cloudFolder) => (
                    <button
                      key={cloudFolder.id}
                      type="button"
                      onClick={() => onOpenCloudFolder?.(cloudFolder)}
                      className="flex w-full items-center gap-2 rounded-lg border border-[#dbe4e7] bg-white px-3 py-2 text-left hover:bg-[#f8fbfc]"
                    >
                      <BookOpen className="h-4 w-4 text-blue-700" />
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-[#26353b]">
                        {cloudFolder.name}
                      </span>
                      <span className="text-[11px] font-semibold text-[#7c8b91]">
                        打开
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {project.localFolders.length === 0 && cloudFolders.length === 0 && (
              <div className="border border-dashed border-gray-300 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-gray-700">
                  当前项目还没有绑定资料
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  请在聊天框上方点击“绑定本地文件夹”，或从左侧文献资料拖入云端文件夹。
                </p>
              </div>
            )}

            {contextMenu && (
              <div
                className="fixed z-[90] w-44 rounded-lg border border-gray-200 bg-white p-1 text-sm shadow-2xl"
                style={{
                  left: Math.min(contextMenu.x, window.innerWidth - 190),
                  top: Math.min(contextMenu.y, window.innerHeight - 360),
                }}
                onClick={(event) => event.stopPropagation()}
              >
                {contextMenu.kind === "file" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => runTask("single_read", [contextMenu.file])}
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      单篇精读
                    </button>
                    <button
                      type="button"
                      onClick={() => runTask("translate_en", [contextMenu.file])}
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      翻译为英文
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runTask("translate_bilingual", [contextMenu.file])
                      }
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      中英双语翻译
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setContextMenu(null);
                        onToggleLocalFile?.(contextMenu.file.id);
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      {selectedLocalFileSet.has(contextMenu.file.id)
                        ? "取消本次分析"
                        : "加入本次分析"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setContextMenu(null);
                        onOpenLocalPdf?.(contextMenu.file);
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      打开 PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setContextMenu(null);
                        onReadLocalPdf?.(contextMenu.file);
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      测试全文读取
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => runTask("analysis", contextMenu.folder.files)}
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      分析该文件夹
                    </button>
                    <button
                      type="button"
                      onClick={() => runTask("matrix", contextMenu.folder.files)}
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      生成文献矩阵
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runTask("translate_en", contextMenu.folder.files)
                      }
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      全部译为英文
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        runTask("translate_bilingual", contextMenu.folder.files)
                      }
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      全部中英双语
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setContextMenu(null);
                        onToggleLocalFolder?.(contextMenu.folder);
                      }}
                      className="block w-full rounded-md px-3 py-2 text-left font-semibold text-gray-800 hover:bg-[#eef6f9]"
                    >
                      全选/取消该文件夹
                    </button>
                  </>
                )}
              </div>
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
