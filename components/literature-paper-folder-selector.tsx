"use client";

import { useEffect, useMemo, useState } from "react";
import { LiteratureCreateFolderModal } from "@/components/literature-create-folder-modal";
import {
  createLiteratureFolder,
  fetchLiteratureFolders,
} from "@/lib/literature/client";
import {
  flattenFolderTree,
  formatFolderTreeLabel,
} from "@/lib/literature/folder-tree";
import type { LiteratureFolder } from "@/lib/literature/types";

type LiteraturePaperFolderSelectorProps = {
  title: string;
  description: string;
  confirmLabel: string;
  folders: LiteratureFolder[];
  selectedFolderIds: string[];
  onClose: () => void;
  onConfirm: (folderIds: string[]) => Promise<void>;
  onFoldersUpdated?: (folders: LiteratureFolder[]) => void;
};

export function LiteraturePaperFolderSelector({
  title,
  description,
  confirmLabel,
  folders,
  selectedFolderIds,
  onClose,
  onConfirm,
  onFoldersUpdated,
}: LiteraturePaperFolderSelectorProps) {
  const [folderItems, setFolderItems] = useState<LiteratureFolder[]>(folders);
  const [draftIds, setDraftIds] = useState<string[]>(selectedFolderIds);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    setFolderItems(folders);
  }, [folders]);

  useEffect(() => {
    setDraftIds(selectedFolderIds);
  }, [selectedFolderIds]);

  const folderTree = useMemo(() => flattenFolderTree(folderItems), [folderItems]);

  const toggleFolder = (folderId: string) => {
    setDraftIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
    );
  };

  const refreshFolders = async (): Promise<LiteratureFolder[]> => {
    const refreshed = await fetchLiteratureFolders();
    setFolderItems(refreshed);
    onFoldersUpdated?.(refreshed);
    return refreshed;
  };

  const handleCreateFolder = async (input: {
    name: string;
    parentId: string | null;
    description: string | null;
  }) => {
    const created = await createLiteratureFolder(input);
    await refreshFolders();
    setDraftIds((current) =>
      current.includes(created.id) ? current : [...current, created.id],
    );
  };

  const handleConfirm = async () => {
    setIsSaving(true);
    setError(null);

    try {
      await onConfirm(draftIds);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存文献夹失败。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="关闭文献夹选择器"
          className="absolute inset-0 bg-black/30"
          onClick={onClose}
        />

        <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{title}</h2>
              <p className="mt-1 text-sm text-gray-500">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              关闭
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="mb-3 flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
          >
            <span aria-hidden="true">📁</span>
            <span>新建文件夹</span>
          </button>

          {folderTree.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
              暂无文献夹，请点击上方「新建文件夹」创建。
            </p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {folderTree.map(({ folder, depth }) => (
                <li key={folder.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-3 py-2.5 transition-colors hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={draftIds.includes(folder.id)}
                      onChange={() => toggleFolder(folder.id)}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-gray-800">
                        {formatFolderTreeLabel(folder.name, depth)}
                      </span>
                      {folder.description && (
                        <span className="mt-1 block text-xs text-gray-500">
                          {folder.description}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                void handleConfirm();
              }}
              className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "正在保存…" : confirmLabel}
            </button>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <LiteratureCreateFolderModal
          folders={folderItems}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateFolder}
        />
      )}
    </>
  );
}
