"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LiteraturePaperFolderSelector } from "@/components/literature-paper-folder-selector";
import { LITERATURE_PRIORITY_LABELS } from "@/lib/literature/constants";
import { setPaperFolders } from "@/lib/literature/client";
import {
  formatLiteratureDate,
  literaturePriorityClassName,
} from "@/lib/literature/paper-display";
import { getPaperStatusLabel } from "@/lib/literature/ui-strings";
import type {
  LiteratureFolder,
  LiteraturePaper,
  LiteraturePaperStatus,
} from "@/lib/literature/types";

type LiteraturePaperCardProps = {
  paper: LiteraturePaper;
  variant: "tracker" | "library";
  onStatusChange: (paperId: string, status: LiteraturePaperStatus) => Promise<void>;
  folders?: LiteratureFolder[];
  onSaveToFolders?: (paperId: string, folderIds: string[]) => Promise<void>;
  onFoldersChange?: (paperId: string, folderIds: string[]) => void;
};

export function LiteraturePaperCard({
  paper,
  variant,
  onStatusChange,
  folders = [],
  onSaveToFolders,
  onFoldersChange,
}: LiteraturePaperCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [folderSelectorMode, setFolderSelectorMode] = useState<
    "save" | "move" | null
  >(null);

  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  const assignedFolderIds = paper.folderIds ?? [];

  const handleStatus = async (status: LiteraturePaperStatus) => {
    setIsUpdating(true);
    try {
      await onStatusChange(paper.id, status);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleFolderConfirm = async (folderIds: string[]) => {
    if (folderSelectorMode === "save" && onSaveToFolders) {
      await onSaveToFolders(paper.id, folderIds);
      return;
    }

    if (folderSelectorMode === "move" && onFoldersChange) {
      const savedIds = await setPaperFolders(paper.id, folderIds);
      onFoldersChange(paper.id, savedIds);
    }
  };

  const externalLabel = "原文链接";

  return (
    <>
      <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {paper.priority && (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${literaturePriorityClassName(paper.priority)}`}
                >
                  {LITERATURE_PRIORITY_LABELS[paper.priority]}
                </span>
              )}
              {paper.relevanceScore !== null && (
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  相关度 {paper.relevanceScore}
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                {getPaperStatusLabel(paper.status)}
              </span>
              {assignedFolderIds.map((folderId) => {
                const name = folderNameById.get(folderId);
                if (!name) {
                  return null;
                }

                return (
                  <span
                    key={folderId}
                    className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
                  >
                    {name}
                  </span>
                );
              })}
            </div>

            <h3 className="text-base font-semibold">
              <Link
                href={`/literature/papers/${paper.id}`}
                className="text-blue-700 underline decoration-blue-300 underline-offset-2 transition-colors hover:text-blue-900 hover:decoration-blue-500"
              >
                {paper.title}
              </Link>
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {paper.authors.slice(0, 4).join(", ")}
              {paper.authors.length > 4 ? " 等" : ""} ·{" "}
              {formatLiteratureDate(paper.publishedAt)}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              {paper.arxivId.startsWith("pubmed:")
                ? `PubMed:${paper.arxivId.slice("pubmed:".length)}`
                : `arXiv:${paper.arxivId}`}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href={`/literature/papers/${paper.id}`}
              className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 hover:text-blue-900"
            >
              查看详情
            </Link>
            <a
              href={paper.absUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              {externalLabel}
            </a>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-gray-700 line-clamp-3">
          {paper.abstract}
        </p>

        {paper.recommendationReason && (
          <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <span className="font-medium text-gray-700">推荐理由：</span>
            {paper.recommendationReason}
          </p>
        )}

        {paper.chineseSummary && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="text-sm font-medium text-gray-700 transition-colors hover:text-gray-900"
            >
              {expanded ? "隐藏 AI 总结" : "显示 AI 总结"}
            </button>

            {expanded && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                  {paper.chineseSummary}
                </pre>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {variant === "tracker" ? (
            <>
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => setFolderSelectorMode("save")}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                保存到文献夹
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => {
                  void handleStatus("skipped");
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                忽略
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => {
                  void handleStatus("read");
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                标记已读
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => {
                  void handleStatus("read");
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                标记已读
              </button>
              {paper.status === "saved" && (
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => {
                    void handleStatus("new");
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  取消收藏
                </button>
              )}
              {paper.status === "skipped" && (
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => {
                    void handleStatus("new");
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  恢复
                </button>
              )}
              <button
                type="button"
                onClick={() => setFolderSelectorMode("move")}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
              >
                移动到文献夹
              </button>
            </>
          )}
        </div>
      </article>

      {folderSelectorMode && (
        <LiteraturePaperFolderSelector
          title={folderSelectorMode === "save" ? "保存到文献夹" : "移动到文献夹"}
          description={
            folderSelectorMode === "save"
              ? "选择一个或多个文献夹，论文将标记为已收藏。"
              : "添加或移除该论文所属的文献夹。"
          }
          confirmLabel={folderSelectorMode === "save" ? "保存到文献夹" : "保存"}
          folders={folders}
          selectedFolderIds={assignedFolderIds}
          onClose={() => setFolderSelectorMode(null)}
          onConfirm={handleFolderConfirm}
        />
      )}
    </>
  );
}
