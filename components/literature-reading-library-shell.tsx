"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ResearchPageHeader } from "@/components/research-page-header";
import { fetchLiteratureLibrary, LiteratureError } from "@/lib/literature/client";
import type { LiteraturePaper } from "@/lib/literature/types";

const ALL_LIBRARY_FILTERS = {
  status: "all" as const,
  q: "",
  source: "",
  discipline: "",
  priority: "",
  folderId: "",
};

function PaperChoice({ paper }: { paper: LiteraturePaper }) {
  const pdfReady = paper.pdfDownloadStatus === "stored";

  return (
    <article className="border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span
              className={`px-2 py-1 ${
                pdfReady
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-amber-50 text-amber-800"
              }`}
            >
              {pdfReady ? "PDF 已入库" : "缺少 PDF"}
            </span>
            {paper.publishedAt && (
              <span className="text-gray-500">{paper.publishedAt.slice(0, 4)}</span>
            )}
          </div>
          <h2 className="mt-3 text-base font-bold leading-6 text-gray-950">
            {paper.title}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {paper.authors.slice(0, 4).join(", ") || "未知作者"}
          </p>
          {paper.abstract && (
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-gray-600">
              {paper.abstract}
            </p>
          )}
        </div>

        {pdfReady ? (
          <Link
            href={`/literature/papers/${paper.id}/reading`}
            className="shrink-0 rounded-md bg-blue-700 px-4 py-2.5 text-center text-sm font-bold text-white shadow-sm hover:bg-blue-800"
          >
            开始 AI 精读
          </Link>
        ) : (
          <Link
            href="/literature/library"
            className="shrink-0 rounded-md border border-gray-300 bg-white px-4 py-2.5 text-center text-sm font-bold text-gray-800 hover:bg-gray-100"
          >
            前往上传 PDF
          </Link>
        )}
      </div>
    </article>
  );
}

export function LiteratureReadingLibraryShell() {
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetchLiteratureLibrary(ALL_LIBRARY_FILTERS)
      .then((result) => {
        if (!cancelled) setPapers(result.papers);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof LiteratureError ? err.message : "加载文献库失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPapers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matched = normalizedQuery
      ? papers.filter((paper) =>
          [paper.title, paper.abstract, paper.authors.join(" ")]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
      : papers;

    return [...matched].sort((left, right) => {
      const leftReady = left.pdfDownloadStatus === "stored" ? 1 : 0;
      const rightReady = right.pdfDownloadStatus === "stored" ? 1 : 0;
      return rightReady - leftReady;
    });
  }, [papers, query]);

  const readyCount = papers.filter((paper) => paper.pdfDownloadStatus === "stored").length;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950">
      <ResearchPageHeader
        title="单篇文献精读"
        description="按研究问题、技术路线、关键实验、结果证据、创新性与局限性拆解一篇论文。"
        maxWidth="6xl"
        actions={
          <Link href="/literature/library" className="text-sm font-bold text-blue-700 hover:text-blue-900">
            管理文献库
          </Link>
        }
      />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <section className="border border-blue-200 bg-blue-50 px-5 py-4">
          <p className="text-sm font-bold text-blue-950">
            已有 {readyCount} 篇论文可进行全文精读
          </p>
          <p className="mt-1 text-sm leading-6 text-blue-800">
            只有已上传并成功入库的 PDF 才会进入全文分析；系统不会用链接或摘要冒充全文证据。
          </p>
        </section>

        <label className="block">
          <span className="mb-2 block text-sm font-bold text-gray-900">选择需要解读的论文</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、作者或摘要"
            className="w-full border border-gray-300 bg-white px-4 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        {error ? (
          <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
        ) : isLoading ? (
          <div className="border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">
            正在加载文献库…
          </div>
        ) : filteredPapers.length === 0 ? (
          <div className="border border-dashed border-gray-300 bg-white px-5 py-12 text-center">
            <p className="text-sm font-bold text-gray-900">没有找到可选择的论文</p>
            <Link href="/literature/library" className="mt-3 inline-block text-sm font-bold text-blue-700">
              前往文献库上传 PDF
            </Link>
          </div>
        ) : (
          <section className="space-y-3">
            {filteredPapers.map((paper) => (
              <PaperChoice key={paper.id} paper={paper} />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
