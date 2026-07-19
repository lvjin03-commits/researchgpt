"use client";

import { BookOpen, LoaderCircle, PanelRightClose, X } from "lucide-react";
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
  onClose: () => void;
};

function pdfState(paper: LiteraturePaper): string {
  if (paper.pdfDownloadStatus === "stored") return "PDF 全文";
  if (paper.abstract) return "标题与摘要";
  return "待补充";
}

export function ResearchToolPanel({
  open,
  folder,
  papers,
  isStreaming,
  activity,
  onClose,
}: ResearchToolPanelProps) {
  if (!open) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(430px,92vw)] flex-col border-l border-gray-200 bg-white shadow-2xl lg:static lg:z-auto lg:w-[360px] lg:shrink-0 lg:shadow-none xl:w-[420px]">
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
        <button
          type="button"
          onClick={onClose}
          aria-label="收起功能工作台"
          className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-100"
        >
          <PanelRightClose className="hidden h-4 w-4 lg:block" />
          <X className="h-4 w-4 lg:hidden" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
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
              <div className="border border-dashed border-gray-300 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-gray-700">
                  这个文件夹暂时没有文献
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  可前往文献库上传 PDF 或添加搜索结果。
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 border-y border-gray-200">
                {papers.slice(0, 50).map((paper) => (
                  <li key={paper.id} className="py-3">
                    <a
                      href={`/literature/papers/${paper.id}`}
                      className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900 hover:text-blue-700"
                    >
                      {paper.title}
                    </a>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-gray-500">
                      <span>{paper.publishedAt?.slice(0, 4) || "年份未知"}</span>
                      <span>{pdfState(paper)}</span>
                    </div>
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
              <p className="mt-2 text-xs leading-5 text-gray-500">
                双击左侧文件夹查看文献；AI 执行分析、翻译或成果制作时，也会在这里显示过程。
              </p>
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
