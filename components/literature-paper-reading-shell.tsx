"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ResearchPageHeader } from "@/components/research-page-header";
import { exportContent, ExportError } from "@/lib/export/client";
import {
  extractLiteraturePaperFigures,
  fetchLiteraturePaper,
  generateLiteraturePaperWorkspace,
  LiteratureError,
} from "@/lib/literature/client";
import type {
  LiteraturePaper,
  PaperEvidenceItem,
  PaperVisualizationPlan,
  PaperWorkspaceAnalysis,
} from "@/lib/literature/types";

type ReadingStage = "source" | "analysis" | "evidence" | "output";

const STAGES: Array<{ id: ReadingStage; label: string; description: string }> = [
  { id: "source", label: "文献解析", description: "确认全文与图表可读" },
  { id: "analysis", label: "分析底稿", description: "建立研究与实验逻辑" },
  { id: "evidence", label: "图表与证据", description: "核对结论和可视化" },
  { id: "output", label: "生成成果", description: "制作PPT或精读PDF" },
];

const CHART_TYPE_LABELS: Record<PaperVisualizationPlan["chartType"], string> = {
  bar: "柱状图",
  line: "折线图",
  scatter: "散点图",
  heatmap: "热力图",
  pie: "饼图",
  stacked_bar: "堆叠柱状图",
  process: "技术路线图",
  timeline: "时间轴",
  mechanism: "机制示意图",
  evidence_card: "证据卡片",
};

const DATA_STATUS_LABELS: Record<PaperVisualizationPlan["dataStatus"], string> = {
  exact: "原文明确数据",
  table_extractable: "可从表格提取",
  figure_only: "仅能引用原图",
  conceptual: "解释性示意图",
  insufficient: "数据不足",
};

const STRENGTH_LABELS: Record<PaperEvidenceItem["strength"], string> = {
  high: "证据较强",
  medium: "证据中等",
  low: "证据有限",
};

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

function DataPreview({ plan }: { plan: PaperVisualizationPlan }) {
  if (plan.dataPoints.length === 0) {
    return (
      <div className="flex min-h-36 items-center justify-center border border-dashed border-gray-300 bg-gray-50 px-5 text-center text-sm text-gray-500">
        {plan.dataStatus === "conceptual"
          ? `将根据原文逻辑生成${CHART_TYPE_LABELS[plan.chartType]}`
          : "没有经过核对的数值，暂不生成数据图"}
      </div>
    );
  }

  const maxValue = Math.max(...plan.dataPoints.map((point) => Math.abs(point.value)), 1);
  return (
    <div className="space-y-3 border border-gray-200 bg-gray-50 p-4">
      {plan.dataPoints.slice(0, 8).map((point, index) => (
        <div key={`${point.series}-${point.label}-${index}`}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-gray-600">
            <span className="min-w-0 truncate">{point.label}</span>
            <span className="shrink-0 font-semibold text-gray-900">
              {point.value.toLocaleString("zh-CN")} {point.unit}
            </span>
          </div>
          <div className="h-2 bg-gray-200">
            <div
              className="h-full bg-blue-600"
              style={{ width: `${Math.max(3, Math.abs(point.value) / maxValue * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function buildReadingMarkdown(
  paper: LiteraturePaper,
  analysis: PaperWorkspaceAnalysis,
): string {
  const sections = [
    `# ${paper.title}`,
    `> ${analysis.oneSentenceSummary}`,
    "## 研究问题",
    analysis.researchProblem,
    "## 核心假设",
    analysis.coreHypothesis || "原文未明确提出可验证假设。",
    "## 技术路线",
    ...(analysis.technicalRoute ?? []).map((item, index) => `${index + 1}. ${item}`),
    "## 关键实验",
    ...(analysis.keyExperiments ?? []).flatMap((experiment, index) => [
      `### ${index + 1}. ${experiment.title}`,
      `- 目的：${experiment.purpose}`,
      `- 设计：${experiment.design}`,
      `- 变量：${experiment.variables}`,
      `- 条件：${experiment.conditions}`,
      `- 结果：${experiment.result}`,
      `- 证据：${experiment.evidenceRefs.join("；") || "待核对"}`,
    ]),
    "## 结果证据",
    ...(analysis.evidenceItems ?? []).flatMap((item) => [
      `### ${item.claim}`,
      `- 来源：${item.sourceRef}${item.page ? `，第 ${item.page} 页` : ""}`,
      `- 证据：${item.evidence}`,
      `- 解读：${item.interpretation}`,
      `- 限制：${item.limitation}`,
      `- 强度：${STRENGTH_LABELS[item.strength]}`,
    ]),
    "## 创新性",
    ...(analysis.innovations ?? []).map((item) => `- ${item}`),
    analysis.mainContributions,
    "## 局限性",
    analysis.limitations,
    "## 后续研究",
    ...(analysis.futureDirections ?? []).map((item) => `- ${item}`),
    "## 建议可视化",
    ...(analysis.visualizationPlans ?? []).flatMap((plan) => [
      `### ${plan.title}`,
      `- 图表：${CHART_TYPE_LABELS[plan.chartType]}`,
      `- 结论：${plan.takeaway}`,
      `- 来源：${plan.sourceRefs.join("；") || "基于原文整理"}`,
      `- 数据状态：${DATA_STATUS_LABELS[plan.dataStatus]}`,
      `- 注意：${plan.caution}`,
    ]),
  ];
  return sections.filter(Boolean).join("\n\n");
}

function buildPresentationOutline(
  paper: LiteraturePaper,
  analysis: PaperWorkspaceAnalysis,
): string {
  const evidence = analysis.evidenceItems ?? [];
  const experiments = analysis.keyExperiments ?? [];
  const visuals = analysis.visualizationPlans ?? [];
  const slides = [
    `## ${paper.title}\n结论：${analysis.oneSentenceSummary}\n图示：summary`,
    `## 研究背景与问题\n结论：${analysis.researchProblem}\n- ${analysis.whyItMatters}\n图示：insight`,
    `## 核心假设\n结论：${analysis.coreHypothesis || "作者围绕核心问题建立验证路径"}\n图示：framework`,
    `## 整体技术路线\n结论：研究通过连续实验建立证据链\n${(analysis.technicalRoute ?? []).map((item) => `- ${item}`).join("\n")}\n图示：framework`,
    ...experiments.slice(0, 4).map((item) =>
      `## ${item.title}\n结论：${item.result}\n- 实验目的：${item.purpose}\n- 实验设计：${item.design}\n- 条件与变量：${item.conditions}；${item.variables}\n图示：evidence`,
    ),
    ...evidence.slice(0, 4).map((item) =>
      `## ${item.claim}\n结论：${item.interpretation}\n- 原文证据：${item.evidence}\n- 来源：${item.sourceRef}${item.page ? `，第${item.page}页` : ""}\n- 局限：${item.limitation}\n图示：evidence`,
    ),
    ...visuals.slice(0, 2).map((item) =>
      `## ${item.title}\n结论：${item.takeaway}\n- 推荐图表：${CHART_TYPE_LABELS[item.chartType]}\n- 数据状态：${DATA_STATUS_LABELS[item.dataStatus]}\n- 来源：${item.sourceRefs.join("；") || "基于原文整理"}\n图示：${item.chartType === "timeline" ? "timeline" : item.chartType === "process" || item.chartType === "mechanism" ? "framework" : "comparison"}`,
    ),
    `## 创新性\n结论：${analysis.mainContributions}\n${(analysis.innovations ?? []).map((item) => `- ${item}`).join("\n")}\n图示：insight`,
    `## 局限性与证据缺口\n结论：${analysis.limitations}\n图示：gap`,
    `## 总结与后续研究\n结论：${analysis.oneSentenceSummary}\n${(analysis.futureDirections ?? []).map((item) => `- ${item}`).join("\n")}\n图示：future`,
  ];
  return slides.join("\n\n");
}

export function LiteraturePaperReadingShell({ paperId }: { paperId: string }) {
  const router = useRouter();
  const [paper, setPaper] = useState<LiteraturePaper | null>(null);
  const [analysis, setAnalysis] = useState<PaperWorkspaceAnalysis | null>(null);
  const [stage, setStage] = useState<ReadingStage>("source");
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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
        setIsExtracting(true);
        try {
          const extracted = await extractLiteraturePaperFigures(paper.id);
          setPaper(extracted.paper);
        } catch {
          setMessage("全文分析已完成，但部分原文图表未能自动提取，可稍后在图表步骤重试。");
        } finally {
          setIsExtracting(false);
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

  const retryFigureExtraction = async () => {
    if (!paper) return;
    setIsExtracting(true);
    setError(null);
    try {
      const result = await extractLiteraturePaperFigures(paper.id);
      setPaper(result.paper);
      setMessage(`已检查 ${result.summary.pagesScanned} 页，提取 ${result.summary.imagesExtracted} 张原图。`);
    } catch (err) {
      setError(err instanceof LiteratureError ? err.message : "图表提取失败。");
    } finally {
      setIsExtracting(false);
    }
  };

  const exportPdf = async () => {
    if (!paper || !analysis) return;
    setIsExporting(true);
    setError(null);
    try {
      const result = await exportContent({
        format: "pdf",
        title: `${paper.title}-精读报告`,
        content: buildReadingMarkdown(paper, analysis),
        metadata: { artifactType: "single-paper-reading", paperId: paper.id },
      });
      setMessage(`${result.filename} 已生成并开始下载。`);
    } catch (err) {
      setError(err instanceof ExportError ? err.message : "精读PDF导出失败。");
    } finally {
      setIsExporting(false);
    }
  };

  const openPptWorkspace = () => {
    if (!paper || !analysis) return;
    window.localStorage.setItem(
      "researchai:outline-to-ppt:v1",
      JSON.stringify({
        title: `${paper.title}：单篇文献精读`,
        outline: buildPresentationOutline(paper, analysis),
        model: "gpt-5.4-mini",
        templateId: "research-modern",
        deck: null,
      }),
    );
    router.push("/presentation");
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
        <nav aria-label="精读流程" className="grid gap-2 md:grid-cols-4">
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
        ) : !analysis ? null : stage === "analysis" ? (
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
            <div className="flex justify-end"><button type="button" onClick={() => setStage("evidence")} className="rounded-lg bg-gray-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-gray-800">下一步：核对图表与证据</button></div>
          </div>
        ) : stage === "evidence" ? (
          <div className="space-y-6">
            <Panel title="结论与证据链" description="区分原文结论、AI解读和证据限制。">
              <div className="space-y-4">
                {(analysis.evidenceItems ?? []).map((item) => (
                  <article key={item.id} className="border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="max-w-3xl font-semibold text-gray-950">{item.claim}</h3>
                      <span className={`px-2 py-1 text-xs font-bold ${item.strength === "high" ? "bg-emerald-50 text-emerald-700" : item.strength === "medium" ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>{STRENGTH_LABELS[item.strength]}</span>
                    </div>
                    <p className="mt-3 text-sm text-blue-800">来源：{item.sourceRef}{item.page ? `，第 ${item.page} 页` : ""}</p>
                    <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                      <div><strong className="text-gray-500">原文证据</strong><p className="mt-1 leading-6 text-gray-700">{item.evidence}</p></div>
                      <div><strong className="text-gray-500">AI解读</strong><p className="mt-1 leading-6 text-gray-700">{item.interpretation}</p></div>
                      <div><strong className="text-gray-500">证据限制</strong><p className="mt-1 leading-6 text-gray-700">{item.limitation || "原文未说明额外限制。"}</p></div>
                    </div>
                  </article>
                ))}
              </div>
            </Panel>
            <Panel title="原文图表" description="优先使用原文图表支撑实验结果。">
              <div className="mb-4 flex justify-end"><button type="button" disabled={isExtracting} onClick={() => void retryFigureExtraction()} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-800 hover:bg-blue-100 disabled:opacity-60">{isExtracting ? "正在提取…" : "重新提取原图"}</button></div>
              {figures.length > 0 ? <div className="grid gap-4 md:grid-cols-2">{figures.map((figure) => <article key={figure.id} className="overflow-hidden border border-gray-200"><a href={`/api/literature/papers/${paper.id}/figures/${encodeURIComponent(figure.id)}`} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] bg-gray-50"><Image src={`/api/literature/papers/${paper.id}/figures/${encodeURIComponent(figure.id)}`} alt={`${figure.label} ${figure.caption}`} fill unoptimized className="object-contain" /></a><div className="p-3"><div className="flex justify-between gap-2"><strong className="text-sm text-gray-950">{figure.label}</strong><span className="text-xs text-gray-500">第 {figure.page ?? "?"} 页</span></div><p className="mt-2 line-clamp-4 text-sm leading-6 text-gray-600">{figure.caption}</p></div></article>)}</div> : <p className="border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500">尚未提取到可用原图。扫描版、组合图或特殊PDF可能需要人工确认。</p>}
            </Panel>
            <Panel title="数据可视化建议" description="只有原文明确提供的数值才会进入数据图。">
              <div className="grid gap-5 lg:grid-cols-2">
                {(analysis.visualizationPlans ?? []).map((plan) => (
                  <article key={plan.id} className="border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold text-gray-950">{plan.title}</h3><span className="bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800">{CHART_TYPE_LABELS[plan.chartType]}</span></div>
                    <p className="mt-2 text-sm font-medium text-gray-800">{plan.takeaway}</p>
                    <p className="mt-1 text-xs text-gray-500">{DATA_STATUS_LABELS[plan.dataStatus]} · {plan.sourceRefs.join("；") || "基于原文整理"}</p>
                    <div className="mt-4"><DataPreview plan={plan} /></div>
                    {plan.caution && <p className="mt-3 text-xs leading-5 text-amber-800">注意：{plan.caution}</p>}
                  </article>
                ))}
              </div>
            </Panel>
            <div className="flex justify-end"><button type="button" onClick={() => setStage("output")} className="rounded-lg bg-gray-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-gray-800">下一步：生成成果</button></div>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="学术精读PPT" description="将精读底稿转换为结论型标题、证据页和可视化页面。">
              <ul className="space-y-2 text-sm leading-6 text-gray-700"><li>12至15页学术汇报故事线</li><li>关键实验与结果证据单独成页</li><li>原文图表位置和数据图建议进入大纲</li><li>进入成果制作后可继续选择模板和修改</li></ul>
              <button type="button" onClick={openPptWorkspace} className="mt-5 w-full rounded-lg bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800">进入PPT制作</button>
            </Panel>
            <Panel title="PDF精读报告" description="适合保存、分享和逐条核对论文证据。">
              <ul className="space-y-2 text-sm leading-6 text-gray-700"><li>研究问题、假设和技术路线</li><li>关键实验与证据强度</li><li>创新性、局限性和后续方向</li><li>图表来源与可视化建议</li></ul>
              <button type="button" disabled={isExporting} onClick={() => void exportPdf()} className="mt-5 w-full rounded-lg bg-gray-950 px-5 py-3 text-sm font-bold text-white hover:bg-gray-800 disabled:bg-gray-300">{isExporting ? "正在生成PDF…" : "导出精读PDF"}</button>
            </Panel>
          </div>
        )}
      </main>
    </div>
  );
}
