"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ResearchPageHeader } from "@/components/research-page-header";
import {
  extractLiteraturePaperFigures,
  fetchLiteraturePaper,
  generateLiteraturePaperWorkspace,
  LiteratureError,
} from "@/lib/literature/client";
import type {
  LiteraturePaper,
  PaperWorkspaceAnalysis,
} from "@/lib/literature/types";

type ReadingStage = "source" | "analysis";

const STAGES: Array<{ id: ReadingStage; label: string; description: string }> = [
  { id: "source", label: "文献解析", description: "确认全文与图表可读" },
  { id: "analysis", label: "分析底稿", description: "建立研究与实验逻辑" },
];

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-950">{title}</h2>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AnalysisBlock({ title, value }: { title: string; value: string }) {
  return (
    <article className="border-l-2 border-blue-600 pl-4">
      <h3 className="text-sm font-semibold text-gray-950">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-gray-700">
        {value || "本篇文献暂未提供足够信息。"}
      </p>
    </article>
  );
}


export function LiteraturePaperReadingShell({ paperId }: { paperId: string }) {
  const [paper, setPaper] = useState<LiteraturePaper | null>(null);
  const [analysis, setAnalysis] = useState<PaperWorkspaceAnalysis | null>(null);
  const [stage, setStage] = useState<ReadingStage>("source");
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchLiteraturePaper(paperId)
      .then((loaded) => {
        if (cancelled) return;
        setPaper(loaded);
        setAnalysis(loaded.workspaceAnalysis ?? null);
        if (
          loaded.workspaceAnalysis?.evidenceLevel === "full_text" &&
          Array.isArray(loaded.workspaceAnalysis.visualizationPlans)
        ) {
          setStage("analysis");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof LiteratureError ? err.message : "加载文献失败。");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const figures = useMemo(
    () => paper?.figureEvidence?.filter((item) => item.imageStoragePath) ?? [],
    [paper?.figureEvidence],
  );
  const fullTextReady = Boolean(paper?.fullTextExtractedAt);
  const fullAnalysisReady =
    analysis?.evidenceLevel === "full_text" &&
    Array.isArray(analysis.visualizationPlans);

  const runFullReading = async () => {
    if (!paper) return;
    if (paper.pdfDownloadStatus !== "stored") {
      setError("这篇文献还没有入库 PDF。请先在文献库上传 PDF，再开始全文精读。");
      return;
    }
    setError(null);
    setMessage(null);
    setIsAnalyzing(true);
    setProgress("正在解析PDF全文并识别研究问题…");
    try {
      const result = await generateLiteraturePaperWorkspace(paper.id, {
        refresh: true,
        requireFullText: true,
      });
      setPaper(result.paper);
      setAnalysis(result.workspaceAnalysis);
      setProgress("全文分析完成，正在检查原文图表…");
      if ((result.paper.figureEvidence ?? []).filter((item) => item.imageStoragePath).length === 0) {
        try {
          const extracted = await extractLiteraturePaperFigures(paper.id);
          setPaper(extracted.paper);
        } catch {
          setMessage("全文分析已完成，但部分原文图表未能自动提取。");
        }
      }
      setStage("analysis");
      setProgress("");
    } catch (err) {
      setProgress("");
      setError(err instanceof LiteratureError ? err.message : "全文精读失败。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-dvh bg-gray-50">
      <ResearchPageHeader
        title="AI文献精读"
        description="把一篇论文拆解为研究逻辑、实验设计、证据链和可视化成果。"
        maxWidth="6xl"
        actions={
          <Link
            href={`/literature/papers/${paperId}`}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-900 hover:bg-gray-100"
          >
            返回论文详情
          </Link>
        }
      />

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <nav aria-label="精读流程" className="grid gap-2 md:grid-cols-2">
          {STAGES.map((item, index) => {
            const active = stage === item.id;
            const disabled = item.id !== "source" && !fullAnalysisReady;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => setStage(item.id)}
                className={`min-h-24 border px-4 py-3 text-left transition-colors ${
                  active
                    ? "border-blue-700 bg-blue-700 text-white"
                    : "border-gray-200 bg-white text-gray-800 hover:border-gray-300"
                } disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400`}
              >
                <span className="text-xs font-bold">0{index + 1}</span>
                <span className="mt-2 block text-sm font-bold">{item.label}</span>
                <span className={`mt-1 block text-xs ${active ? "text-blue-100" : "text-gray-500"}`}>
                  {item.description}
                </span>
              </button>
            );
          })}
        </nav>

        {error && <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && <p className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>}
        {progress && <p className="border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">{progress}</p>}

        {isLoading || !paper ? (
          <Panel title={isLoading ? "正在加载文献" : "未找到文献"}>
            <p className="text-sm text-gray-500">{isLoading ? "请稍候…" : "请返回文献库重新选择。"}</p>
          </Panel>
        ) : stage === "source" ? (
          <div className="grid gap-6 lg:grid-cols-[1.45fr_0.75fr]">
            <Panel title={paper.title} description={paper.authors.join(", ") || "未知作者"}>
              <p className="text-sm leading-7 text-gray-700">{paper.abstract}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {paper.pdfDownloadStatus === "stored" && (
                  <a
                    href={`/api/literature/papers/${paper.id}/pdf/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-800 hover:bg-blue-100"
                  >
                    在线查看PDF
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => void runFullReading()}
                  disabled={isAnalyzing}
                  className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {isAnalyzing ? "正在全文精读…" : fullAnalysisReady ? "重新全文精读" : "开始全文精读"}
                </button>
              </div>
            </Panel>
            <Panel title="解析准备度" description="只有可读取全文，才能建立可靠证据链。">
              <ul className="space-y-3 text-sm">
                <li className="flex items-center justify-between gap-3"><span>PDF已入库</span><strong className={paper.pdfDownloadStatus === "stored" ? "text-emerald-700" : "text-red-700"}>{paper.pdfDownloadStatus === "stored" ? "已完成" : "未完成"}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>全文可提取</span><strong className={fullTextReady ? "text-emerald-700" : "text-amber-700"}>{fullTextReady ? "已完成" : "分析时检查"}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>原文图表</span><strong className={figures.length > 0 ? "text-emerald-700" : "text-amber-700"}>{figures.length > 0 ? `${figures.length} 张` : "待提取"}</strong></li>
                <li className="flex items-center justify-between gap-3"><span>证据级别</span><strong className={fullAnalysisReady ? "text-emerald-700" : "text-gray-600"}>{fullAnalysisReady ? "全文" : "尚未分析"}</strong></li>
              </ul>
            </Panel>
          </div>
        ) : !analysis ? null : (
          <div className="space-y-6">
            <Panel title="一句话结论" description="先理解论文最核心的判断。">
              <p className="text-xl font-semibold leading-9 text-gray-950">{analysis.oneSentenceSummary}</p>
            </Panel>
            <Panel title="研究逻辑" description="按照问题、假设、路线、结果和评价建立完整理解。">
              <div className="grid gap-6 lg:grid-cols-2">
                <AnalysisBlock title="研究问题" value={analysis.researchProblem} />
                <AnalysisBlock title="核心假设" value={analysis.coreHypothesis ?? ""} />
                <AnalysisBlock title="核心方法" value={analysis.coreMethod} />
                <AnalysisBlock title="结果概述" value={analysis.experimentalResults} />
                <AnalysisBlock title="创新性" value={(analysis.innovations ?? []).join("\n") || analysis.mainContributions} />
                <AnalysisBlock title="局限性" value={analysis.limitations} />
              </div>
            </Panel>
            <Panel title="技术路线" description="由原文方法和实验顺序整理，属于解释性结构图底稿。">
              <ol className="grid gap-3 md:grid-cols-2">
                {(analysis.technicalRoute ?? []).map((item, index) => (
                  <li key={`${item}-${index}`} className="flex gap-3 border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center bg-blue-700 text-xs font-bold text-white">{index + 1}</span>
                    {item}
                  </li>
                ))}
              </ol>
            </Panel>
            <Panel title="关键实验" description="每项实验都说明目的、设计、结果和对应证据。">
              <div className="space-y-4">
                {(analysis.keyExperiments ?? []).map((experiment, index) => (
                  <article key={`${experiment.title}-${index}`} className="border border-gray-200 p-4">
                    <h3 className="font-semibold text-gray-950">{index + 1}. {experiment.title}</h3>
                    <dl className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                      <div><dt className="font-semibold text-gray-500">实验目的</dt><dd className="mt-1 text-gray-700">{experiment.purpose}</dd></div>
                      <div><dt className="font-semibold text-gray-500">实验设计</dt><dd className="mt-1 text-gray-700">{experiment.design}</dd></div>
                      <div><dt className="font-semibold text-gray-500">变量与条件</dt><dd className="mt-1 text-gray-700">{experiment.variables}；{experiment.conditions}</dd></div>
                      <div><dt className="font-semibold text-gray-500">关键结果</dt><dd className="mt-1 text-gray-700">{experiment.result}</dd></div>
                    </dl>
                    <p className="mt-3 text-xs font-medium text-blue-800">证据：{experiment.evidenceRefs.join("；") || "待核对"}</p>
                  </article>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </main>
    </div>
  );
}
