"use client";

import { useMemo, useState } from "react";
import {
  flattenFolderTree,
  formatFolderTreeLabel,
} from "@/lib/literature/folder-tree";
import type { LiteratureFolder } from "@/lib/literature/types";

type LiteratureLibraryUploadModalProps = {
  folders: LiteratureFolder[];
  initialFolderId?: string;
  onClose: () => void;
  onUpload: (folderIds: string[], file: File) => Promise<void>;
};

export function LiteratureLibraryUploadModal({
  folders,
  initialFolderId,
  onClose,
  onUpload,
}: LiteratureLibraryUploadModalProps) {
  const [draftIds, setDraftIds] = useState<string[]>(
    initialFolderId ? [initialFolderId] : [],
  );
  const [selectedPdfFile, setSelectedPdfFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderTree = useMemo(() => flattenFolderTree(folders), [folders]);

  const toggleFolder = (folderId: string) => {
    setDraftIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
    );
  };

  const handleUpload = async () => {
    if (draftIds.length === 0) {
      setError("请先选择至少一个文献夹。");
      return;
    }

    if (!selectedPdfFile) {
      setError("请先选择一个 PDF 文件。");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      await onUpload(draftIds, selectedPdfFile);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传 PDF 失败。");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭上传弹窗"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              上传本地 PDF
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              选择文献夹并上传 PDF，系统会保存全文，供后续综述和 PPT 使用。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg px-2 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            关闭
          </button>
        </div>

        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-medium text-gray-800">
              选择文献夹
            </h3>
            {folderTree.length === 0 ? (
              <p className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                暂无文献夹，请先在左侧新建一个文献夹。
              </p>
            ) : (
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {folderTree.map(({ folder, depth }) => (
                  <li key={folder.id}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-3 py-2.5 transition-colors hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={draftIds.includes(folder.id)}
                        disabled={isUploading}
                        onChange={() => toggleFolder(folder.id)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-400"
                      />
                      <span className="min-w-0 flex-1 text-sm font-medium text-gray-800">
                        {formatFolderTreeLabel(folder.name, depth)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <label
              htmlFor="library-pdf-upload"
              className="mb-2 block text-sm font-medium text-gray-800"
            >
              选择 PDF 文件
            </label>
            <input
              id="library-pdf-upload"
              type="file"
              accept="application/pdf,.pdf"
              disabled={isUploading}
              onChange={(event) =>
                setSelectedPdfFile(event.target.files?.[0] ?? null)
              }
              className="block w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-800 hover:file:bg-blue-200"
            />
          </section>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={isUploading || folderTree.length === 0}
            onClick={() => {
              void handleUpload();
            }}
            className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "正在上传 PDF..." : "上传到文献库"}
          </button>
        </div>
      </div>
    </div>
  );
}
