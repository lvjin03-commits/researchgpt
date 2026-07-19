"use client";

import { useCallback, useEffect, useState } from "react";
import { LiteratureLibraryUploadModal } from "@/components/literature-library-upload-modal";
import { LiteraturePaperCard } from "@/components/literature-paper-card";
import { ResearchPageHeader } from "@/components/research-page-header";
import {
  createLiteratureFolder,
  deleteLiteratureFolder,
  deleteLiteraturePaper,
  fetchLiteratureLibrary,
  LiteratureError,
  updateLiteratureFolder,
  updateLiteraturePaperStatus,
  uploadLocalPdfToLibrary,
} from "@/lib/literature/client";
import {
  LIBRARY_PRIORITY_OPTIONS,
  LIBRARY_SOURCE_OPTIONS,
  LIBRARY_STATUS_TABS,
  type LibraryFilters,
  type LibraryStatusTab,
} from "@/lib/literature/library-filters";
import { LITERATURE_DISCIPLINES } from "@/lib/literature/source-taxonomy";
import type {
  LiteratureFolder,
  LiteraturePaper,
  LiteraturePaperStatus,
} from "@/lib/literature/types";

const DEFAULT_FILTERS: LibraryFilters = {
  status: "all",
  q: "",
  source: "",
  discipline: "",
  priority: "",
  folderId: "",
};

export function LiteratureLibraryShell() {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [folders, setFolders] = useState<LiteratureFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderActionError, setFolderActionError] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [showUploadModal, setShowUploadModal] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchLiteratureLibrary(filters);
        if (!cancelled) {
          setPapers(result.papers);
          setFolders(result.folders);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof LiteratureError
              ? err.message
              : "加载文献库失败。";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filters]);

  const handleStatusChange = useCallback(
    async (paperId: string, status: LiteraturePaperStatus) => {
      await updateLiteraturePaperStatus(paperId, status);
      setPapers((current) => {
        const updated = current.map((paper) =>
          paper.id === paperId ? { ...paper, status } : paper,
        );

        if (status === "new") {
          return updated.filter((paper) => paper.id !== paperId);
        }

        if (!filters.folderId && filters.status !== "all" && status !== filters.status) {
          return updated.filter((paper) => paper.id !== paperId);
        }

        return updated;
      });
    },
    [filters.folderId, filters.status],
  );

  const handlePaperFoldersChange = useCallback(
    (paperId: string, folderIds: string[]) => {
      setPapers((current) => {
        const updated = current.map((paper) =>
          paper.id === paperId ? { ...paper, folderIds } : paper,
        );

        if (filters.folderId && !folderIds.includes(filters.folderId)) {
          return updated.filter((paper) => paper.id !== paperId);
        }

        return updated;
      });
    },
    [filters.folderId],
  );

  const setStatusTab = (status: LibraryStatusTab) => {
    setFilters((current) => ({
      ...current,
      status,
      folderId: "",
    }));
  };

  const selectFolder = (folderId: string) => {
    setFilters((current) => ({
      ...current,
      folderId,
    }));
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      return;
    }

    setIsCreatingFolder(true);
    setFolderActionError(null);

    try {
      const created = await createLiteratureFolder({ name: trimmed });
      setFolders((current) => [...current, created]);
      setNewFolderName("");
    } catch (err) {
      setFolderActionError(
        err instanceof LiteratureError ? err.message : "创建文献夹失败。",
      );
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const startEditingFolder = (folder: LiteratureFolder) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
    setFolderActionError(null);
  };

  const cancelEditingFolder = () => {
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  const handleRenameFolder = async (folderId: string) => {
    const trimmed = editingFolderName.trim();
    if (!trimmed) {
      return;
    }

    setFolderActionError(null);

    try {
      const updated = await updateLiteratureFolder(folderId, trimmed);
      setFolders((current) =>
        current.map((folder) => (folder.id === folderId ? updated : folder)),
      );
      cancelEditingFolder();
    } catch (err) {
      setFolderActionError(
        err instanceof LiteratureError ? err.message : "重命名文献夹失败。",
      );
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!window.confirm("确定删除此文献夹？论文仍会保留在文献库中。")) {
      return;
    }

    setFolderActionError(null);

    try {
      await deleteLiteratureFolder(folderId);
      setFolders((current) => current.filter((folder) => folder.id !== folderId));

      if (filters.folderId === folderId) {
        setFilters((current) => ({ ...current, folderId: "" }));
      } else {
        setPapers((current) =>
          current.map((paper) => ({
            ...paper,
            folderIds: (paper.folderIds ?? []).filter((id) => id !== folderId),
          })),
        );
      }

      if (editingFolderId === folderId) {
        cancelEditingFolder();
      }
    } catch (err) {
      setFolderActionError(
        err instanceof LiteratureError ? err.message : "删除文献夹失败。",
      );
    }
  };

  const handleDeletePaper = async (paperId: string) => {
    setError(null);

    try {
      await deleteLiteraturePaper(paperId);
      setPapers((current) => current.filter((paper) => paper.id !== paperId));
    } catch (err) {
      setError(err instanceof LiteratureError ? err.message : "删除文献失败。");
    }
  };

  const handleUploadLocalPdf = useCallback(
    async (folderIds: string[], file: File) => {
      const uploaded = await uploadLocalPdfToLibrary(folderIds, file);
      setPapers((current) => [uploaded, ...current]);
    },
    [],
  );

  return (
    <div className="research-canvas min-h-dvh">
      <ResearchPageHeader
        title="文献库"
        description="集中管理 PDF、文献夹和阅读状态，为后续分析准备资料。"
        maxWidth="6xl"
        actions={
          <button
            type="button"
            onClick={() => setShowUploadModal(true)}
            className="rounded-md bg-[#174866] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#123a52]"
          >
            上传 PDF
          </button>
        }
      />

      <main className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 lg:flex-row lg:items-start lg:px-6">
        <aside className="research-surface w-full shrink-0 rounded-md p-4 lg:sticky lg:top-4 lg:w-64">
          <section className="border-b border-[#e2e9eb] pb-5">
            <p className="research-eyebrow">Views</p>
            <h2 className="mt-1 text-sm font-semibold text-[#26353b]">
              浏览
            </h2>
            <ul className="mt-3 space-y-1">
              {LIBRARY_STATUS_TABS.map((tab) => {
                const isActive = !filters.folderId && filters.status === tab.value;

                return (
                  <li key={tab.value}>
                    <button
                      type="button"
                      onClick={() => setStatusTab(tab.value)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-[#e4eef2] text-[#174866]"
                          : "text-[#52636b] hover:bg-[#f2f6f7]"
                      }`}
                    >
                      {tab.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="pt-5">
            <p className="research-eyebrow">Collections</p>
            <h2 className="mt-1 text-sm font-semibold text-[#26353b]">
              文献夹
            </h2>

            {folders.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">暂无文献夹。</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {folders.map((folder) => {
                  const isActive = filters.folderId === folder.id;
                  const isEditing = editingFolderId === folder.id;

                  return (
                    <li key={folder.id}>
                      {isEditing ? (
                        <div className="space-y-2 rounded-lg border border-gray-200 p-2">
                          <input
                            type="text"
                            value={editingFolderName}
                            onChange={(event) => setEditingFolderName(event.target.value)}
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                          />
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                void handleRenameFolder(folder.id);
                              }}
                              className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingFolder}
                              className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => selectFolder(folder.id)}
                            className={`min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
                              isActive
                                ? "bg-[#f3e8d8] text-[#7a4810]"
                                : "text-[#52636b] hover:bg-[#f2f6f7]"
                            }`}
                          >
                            <span className="block truncate">{folder.name}</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`重命名 ${folder.name}`}
                            onClick={() => startEditingFolder(folder)}
                            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            aria-label={`删除 ${folder.name}`}
                            onClick={() => {
                              void handleDeleteFolder(folder.id);
                            }}
                            className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-4 space-y-2">
              <input
                type="text"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="新文献夹名称"
                className="research-focus w-full rounded-md border border-[#d4dfe2] px-3 py-2 text-sm text-[#172126]"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateFolder();
                  }
                }}
              />
              <button
                type="button"
                disabled={isCreatingFolder || !newFolderName.trim()}
                onClick={() => {
                  void handleCreateFolder();
                }}
                className="w-full rounded-md bg-[#174866] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#123a52] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingFolder ? "正在创建…" : "新建文献夹"}
              </button>
            </div>

            {folderActionError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {folderActionError}
              </p>
            )}
          </section>
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          <section className="research-surface space-y-4 rounded-md p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="research-eyebrow">Library index</p>
                <h2 className="mt-1 text-base font-semibold text-[#172126]">
                  文献索引
                </h2>
              </div>
              <p className="text-xs font-medium text-[#718087]">
                {papers.length} 篇
              </p>
            </div>
            <div>
              <label
                htmlFor="library-search"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                搜索
              </label>
              <input
                id="library-search"
                type="search"
                value={filters.q}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, q: event.target.value }))
                }
                placeholder="搜索标题、作者或摘要"
                className="research-focus w-full rounded-md border border-[#d4dfe2] px-3 py-2.5 text-sm text-[#172126]"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="library-source"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  来源
                </label>
                <select
                  id="library-source"
                  value={filters.source}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, source: event.target.value }))
                  }
                  className="research-focus w-full rounded-md border border-[#d4dfe2] px-3 py-2.5 text-sm text-[#172126]"
                >
                  {LIBRARY_SOURCE_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="library-discipline"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  学科
                </label>
                <select
                  id="library-discipline"
                  value={filters.discipline}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      discipline: event.target.value,
                    }))
                  }
                  className="research-focus w-full rounded-md border border-[#d4dfe2] px-3 py-2.5 text-sm text-[#172126]"
                >
                  <option value="">全部学科</option>
                  {LITERATURE_DISCIPLINES.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="library-priority"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  推荐等级
                </label>
                <select
                  id="library-priority"
                  value={filters.priority}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                  className="research-focus w-full rounded-md border border-[#d4dfe2] px-3 py-2.5 text-sm text-[#172126]"
                >
                  {LIBRARY_PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {isLoading ? (
            <div className="research-surface rounded-md px-5 py-12 text-center text-sm text-[#607078]">
              正在加载文献库…
            </div>
          ) : papers.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#c7d4d8] bg-white px-5 py-12 text-center">
              <p className="text-sm font-medium text-gray-900">未找到论文</p>
              <p className="mt-2 text-sm text-gray-500">
                请尝试其他文献夹，或调整搜索与筛选条件。
              </p>
            </div>
          ) : (
            <section className="space-y-2">
              {papers.map((paper) => (
                <LiteraturePaperCard
                  key={paper.id}
                  paper={paper}
                  variant="library"
                  folders={folders}
                  onStatusChange={handleStatusChange}
                  onFoldersChange={handlePaperFoldersChange}
                  onDelete={handleDeletePaper}
                  onFoldersListUpdated={setFolders}
                />
              ))}
            </section>
          )}
        </div>
      </main>

      {showUploadModal && (
        <LiteratureLibraryUploadModal
          folders={folders}
          initialFolderId={filters.folderId || undefined}
          onClose={() => setShowUploadModal(false)}
          onUpload={handleUploadLocalPdf}
        />
      )}
    </div>
  );
}
