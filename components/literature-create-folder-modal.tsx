"use client";

import { useEffect, useState } from "react";
import {
  flattenFolderTree,
  formatFolderTreeLabel,
} from "@/lib/literature/folder-tree";
import type { LiteratureFolder } from "@/lib/literature/types";

type LiteratureCreateFolderModalProps = {
  folders: LiteratureFolder[];
  onClose: () => void;
  onCreate: (input: {
    name: string;
    parentId: string | null;
    description: string | null;
  }) => Promise<void>;
};

export function LiteratureCreateFolderModal({
  folders,
  onClose,
  onCreate,
}: LiteratureCreateFolderModalProps) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const tree = flattenFolderTree(folders);

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("文件夹名称不能为空。");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await onCreate({
        name: trimmedName,
        parentId: parentId.trim() || null,
        description: description.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建文件夹失败。");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭新建文件夹对话框"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">新建文件夹</h3>

        <div className="mt-4 space-y-4">
          <label className="grid gap-2">
            <span className="text-sm font-medium text-gray-900">文件夹名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="请输入文件夹名称"
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              autoFocus
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-gray-900">父文件夹（可选）</span>
            <select
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            >
              <option value="">无（顶级文件夹）</option>
              {tree.map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {formatFolderTreeLabel(folder.name, depth)}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-gray-900">描述（可选）</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="可填写该文件夹用途说明"
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </label>
        </div>

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
            disabled={isCreating}
            onClick={() => {
              void handleCreate();
            }}
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? "正在创建…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
