"use client";

import { useEffect, useState } from "react";
import type { LiteratureFolder } from "@/lib/literature/types";

type LiteraturePaperFolderSelectorProps = {
  title: string;
  description: string;
  confirmLabel: string;
  folders: LiteratureFolder[];
  selectedFolderIds: string[];
  onClose: () => void;
  onConfirm: (folderIds: string[]) => Promise<void>;
};

export function LiteraturePaperFolderSelector({
  title,
  description,
  confirmLabel,
  folders,
  selectedFolderIds,
  onClose,
  onConfirm,
}: LiteraturePaperFolderSelectorProps) {
  const [draftIds, setDraftIds] = useState<string[]>(selectedFolderIds);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftIds(selectedFolderIds);
  }, [selectedFolderIds]);

  const toggleFolder = (folderId: string) => {
    setDraftIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
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

        {folders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
            暂无文献夹，请先在文献库侧栏新建文献夹。
          </p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {folders.map((folder) => (
              <li key={folder.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 transition-colors hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={draftIds.includes(folder.id)}
                    onChange={() => toggleFolder(folder.id)}
                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                  />
                  <span className="text-sm font-medium text-gray-800">{folder.name}</span>
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
  );
}
