"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  exportLiteratureReview,
  fetchLiteratureFolders,
  fetchLiteratureLibrary,
  generateLiteraturePaperWorkspace,
  generateLiteratureReview,
  LiteratureError,
} from "@/lib/literature/client";
import {
  REVIEW_AUDIENCE_OPTIONS,
  REVIEW_LANGUAGE_OPTIONS,
  REVIEW_LENGTH_OPTIONS,
  REVIEW_MIN_PAPER_COUNT,
  REVIEW_MIN_PAPER_COUNT_ERROR,
  REVIEW_MODEL_OPTIONS,
  REVIEW_PERSPECTIVE_OPTIONS,
  REVIEW_SECTION_OPTIONS,
} from "@/lib/literature/review/constants";
import type {
  LiteratureMatrixRow,
  LiteratureReviewRequest,
  ReviewSection,
  ReviewModel,
  ReviewWorkflowMode,
} from "@/lib/literature/review/types";
import {
  flattenFolderTree,
  formatFolderTreeLabel,
} from "@/lib/literature/folder-tree";
import type { LiteratureFolder, LiteraturePaper } from "@/lib/literature/types";

const DEFAULT_SECTIONS: ReviewSection[] = [
  REVIEW_SECTION_OPTIONS[0],
  REVIEW_SECTION_OPTIONS[1],
  REVIEW_SECTION_OPTIONS[2],
  REVIEW_SECTION_OPTIONS[3],
  REVIEW_SECTION_OPTIONS[6],
  REVIEW_SECTION_OPTIONS[7],
  REVIEW_SECTION_OPTIONS[8],
  REVIEW_SECTION_OPTIONS[9],
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium text-gray-900">{children}</span>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

type AnalysisProgress = {
  total: number;
  completed: number;
  failed: number;
  currentTitle: string | null;
  lastCompletedTitle: string | null;
  failedPapers: Array<{ title: string; reason: string }>;
};

export function LiteratureReviewShell() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const [folders, setFolders] = useState<LiteratureFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [paperCount, setPaperCount] = useState(0);
  const [folderPapers, setFolderPapers] = useState<LiteraturePaper[]>([]);
  const [workflowMode, setWorkflowMode] =
    useState<ReviewWorkflowMode>("quick_outline");
  const [model, setModel] = useState<ReviewModel>("gpt-5.4-mini");
  const [topic, setTopic] = useState("");
  const [perspective, setPerspective] =
    useState<LiteratureReviewRequest["perspective"]>(
      REVIEW_PERSPECTIVE_OPTIONS[0],
    );
  const [customPerspective, setCustomPerspective] = useState("");
  const [targetAudience, setTargetAudience] =
    useState<LiteratureReviewRequest["targetAudience"]>(
      REVIEW_AUDIENCE_OPTIONS[0],
    );
  const [requiredSections, setRequiredSections] =
    useState<ReviewSection[]>(DEFAULT_SECTIONS);
  const [language, setLanguage] =
    useState<LiteratureReviewRequest["language"]>(REVIEW_LANGUAGE_OPTIONS[0]);
  const [length, setLength] =
    useState<LiteratureReviewRequest["length"]>(REVIEW_LENGTH_OPTIONS[1]);
  const [customWordCount, setCustomWordCount] = useState("5000");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [outline, setOutline] = useState("");
  const [literatureMatrix, setLiteratureMatrix] = useState<
    LiteratureMatrixRow[]
  >([]);
  const [matrixConfirmed, setMatrixConfirmed] = useState(false);
  const [themes, setThemes] = useState("");
  const [pptOutline, setPptOutline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isGeneratingThemes, setIsGeneratingThemes] = useState(false);
  const [isAnalyzingPapers, setIsAnalyzingPapers] = useState(false);
  const [isGeneratingPpt, setIsGeneratingPpt] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [analysisProgress, setAnalysisProgress] =
    useState<AnalysisProgress | null>(null);
  const isGenerating =
    isAnalyzingPapers || isGeneratingThemes || isGeneratingOutline || isGeneratingPpt;
  const folderTree = useMemo(() => flattenFolderTree(folders), [folders]);
  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === folderId) ?? null,
    [folders, folderId],
  );
  const selectedModel = REVIEW_MODEL_OPTIONS.find(
    (option) => option.id === model,
  );

  useEffect(() => {
    void (async () => {
      try {
        const loadedFolders = await fetchLiteratureFolders();
        setFolders(loadedFolders);
        const firstFolder = flattenFolderTree(loadedFolders)[0]?.folder;
        if (firstFolder) {
          setFolderId(firstFolder.id);
        }
      } catch (err) {
        setError(
          err instanceof LiteratureError ? err.message : "加载文献夹失败。",
        );
      } finally {
        setIsLoadingFolders(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!folderId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const result = await fetchLiteratureLibrary({
          status: "all",
          q: "",
          source: "",
          discipline: "",
          priority: "",
          folderId,
        });
        if (!cancelled) {
          setPaperCount(result.papers.length);
          setFolderPapers(result.papers);
        }
      } catch {
        if (!cancelled) {
          setPaperCount(0);
          setFolderPapers([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [folderId]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const buildRequestBase = useCallback((): Omit<LiteratureReviewRequest, "phase"> => {
    return {
      folderId: selectedFolder?.id ?? folderId,
      folderName: selectedFolder?.name,
      workflowMode,
      model,
      topic: topic.trim(),
      perspective,
      customPerspective:
        perspective === REVIEW_PERSPECTIVE_OPTIONS[7]
          ? customPerspective.trim()
          : undefined,
      targetAudience,
      requiredSections,
      outputType: "PPT",
      language,
      length,
      customWordCount:
        length === REVIEW_LENGTH_OPTIONS[3] ? Number(customWordCount) : undefined,
      additionalInstructions: additionalInstructions.trim() || undefined,
    };
  }, [
    additionalInstructions,
    customPerspective,
    customWordCount,
    folderId,
    language,
    length,
    model,
    perspective,
    requiredSections,
    selectedFolder,
    targetAudience,
    topic,
    workflowMode,
  ]);

  const hasEnoughPapers = paperCount >= REVIEW_MIN_PAPER_COUNT;
  const readablePaperCount = folderPapers.filter(
    (paper) => Boolean(paper.fullTextExtractedAt),
  ).length;
  const canClickGenerateOutline = !isGenerating && !isLoadingFolders;

  const validateOutlineInput = () => {
    if (!folderId) {
      setError("请先选择一个文献夹。");
      return false;
    }
    if (!topic.trim()) {
      setError("请先填写综述主题。");
      return false;
    }
    if (requiredSections.length === 0) {
      setError("请至少选择一个必需结构。");
      return false;
    }
    if (!hasEnoughPapers) {
      setError(REVIEW_MIN_PAPER_COUNT_ERROR);
      return false;
    }
    return true;
  };

  const startGeneration = () => {
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setError(null);
    setStatusMessage(null);
    return abortController;
  };

  const stopGeneration = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGeneratingOutline(false);
    setIsGeneratingThemes(false);
    setIsAnalyzingPapers(false);
    setIsGeneratingPpt(false);
    setStatusMessage("已停止生成。");
  };

  const changeWorkflowMode = (mode: ReviewWorkflowMode) => {
    setWorkflowMode(mode);
    setModel(mode === "academic_review" ? "gpt-5.4" : "gpt-5.4-mini");
    setOutline("");
    setLiteratureMatrix([]);
    setMatrixConfirmed(false);
    setThemes("");
    setPptOutline("");
    setAnalysisProgress(null);
    setError(null);
    setStatusMessage(null);
  };

  const changeModel = (nextModel: ReviewModel) => {
    setModel(nextModel);
    setOutline("");
    setLiteratureMatrix([]);
    setMatrixConfirmed(false);
    setThemes("");
    setPptOutline("");
    setAnalysisProgress(null);
    setError(null);
    setStatusMessage(null);
  };

  const analyzeAcademicPapers = async (abortController: AbortController) => {
    const total = folderPapers.length;
    let completed = 0;
    let failed = 0;
    let lastCompletedTitle: string | null = null;
    const failedPapers: Array<{ title: string; reason: string }> = [];

    setIsAnalyzingPapers(true);
    setAnalysisProgress({
      total,
      completed,
      failed,
      currentTitle: null,
      lastCompletedTitle,
      failedPapers,
    });

    try {
      for (const paper of folderPapers) {
        if (abortController.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        if (
          paper.workspaceAnalysis?.evidenceLevel === "full_text" &&
          paper.workspaceAnalysis.model === model
        ) {
          completed += 1;
          lastCompletedTitle = paper.title;
          setAnalysisProgress({
            total,
            completed,
            failed,
            currentTitle: null,
            lastCompletedTitle,
            failedPapers: [...failedPapers],
          });
          continue;
        }

        setAnalysisProgress({
          total,
          completed,
          failed,
          currentTitle: paper.title,
          lastCompletedTitle,
          failedPapers: [...failedPapers],
        });

        try {
          const result = await generateLiteraturePaperWorkspace(paper.id, {
            requireFullText: true,
            signal: abortController.signal,
            model,
          });
          completed += 1;
          lastCompletedTitle = paper.title;
          setFolderPapers((current) =>
            current.map((item) => (item.id === paper.id ? result.paper : item)),
          );
        } catch (err) {
          if (isAbortError(err) || abortController.signal.aborted) {
            throw err;
          }
          failed += 1;
          failedPapers.push({
            title: paper.title,
            reason: err instanceof Error ? err.message : "未知错误",
          });
        }

        setAnalysisProgress({
          total,
          completed,
          failed,
          currentTitle: null,
          lastCompletedTitle,
          failedPapers: [...failedPapers],
        });
      }

      if (completed < REVIEW_MIN_PAPER_COUNT) {
        throw new LiteratureError(
          `只有 ${completed} 篇文献完成全文分析，至少需要 ${REVIEW_MIN_PAPER_COUNT} 篇。请查看下方逐篇失败原因。`,
          422,
        );
      }

      setStatusMessage(
        failed > 0
          ? `已完成 ${completed} 篇全文分析，${failed} 篇失败；正在使用成功文献生成大纲。`
          : `已完成全部 ${completed} 篇全文分析，正在生成大纲。`,
      );
    } finally {
      setIsAnalyzingPapers(false);
    }
  };

  const toggleSection = (section: ReviewSection) => {
    setRequiredSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  };

  const handleGenerateMatrix = async () => {
    if (!validateOutlineInput()) {
      return;
    }

    const abortController = startGeneration();
    setIsGeneratingOutline(true);

    try {
      if (workflowMode === "academic_review") {
        await analyzeAcademicPapers(abortController);
      }

      const result = await generateLiteratureReview(
        {
          ...buildRequestBase(),
          phase: "matrix",
          uiPaperCount: paperCount,
        },
        abortController.signal,
      );
      setLiteratureMatrix(result.matrix ?? []);
      setMatrixConfirmed(false);
      setThemes("");
      setOutline("");
      setPptOutline("");
      setStatusMessage(
        workflowMode === "academic_review"
          ? "全文分析与文献矩阵生成完成，请检查矩阵后继续。"
          : "文献矩阵已生成，请检查后继续。",
      );
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof LiteratureError ? err.message : "生成大纲失败。");
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsGeneratingOutline(false);
    }
  };

  const handleGenerateThemes = async () => {
    if (literatureMatrix.length === 0) {
      setError("请先生成文献矩阵。");
      return;
    }
    const abortController = startGeneration();
    setMatrixConfirmed(true);
    setIsGeneratingThemes(true);
    try {
      const result = await generateLiteratureReview(
        {
          ...buildRequestBase(),
          phase: "themes",
          uiPaperCount: paperCount,
        },
        abortController.signal,
      );
      setThemes(result.themes ?? "");
      setOutline("");
      setPptOutline("");
      setStatusMessage("主题归类已生成，请检查或编辑后生成论文大纲。");
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof LiteratureError ? err.message : "生成主题归类失败。");
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsGeneratingThemes(false);
    }
  };

  const handleGenerateOutline = async () => {
    if (!themes.trim()) {
      setError("请先生成并确认主题归类。");
      return;
    }
    const abortController = startGeneration();
    setIsGeneratingOutline(true);
    try {
      const result = await generateLiteratureReview(
        {
          ...buildRequestBase(),
          phase: "outline",
          confirmedThemes: themes.trim(),
          uiPaperCount: paperCount,
        },
        abortController.signal,
      );
      setOutline(result.outline ?? "");
      setPptOutline("");
      setStatusMessage("证据驱动的大纲已生成，请检查后生成PPT。");
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof LiteratureError ? err.message : "生成大纲失败。");
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsGeneratingOutline(false);
    }
  };

  const handleGeneratePpt = async () => {
    if (!outline.trim()) {
      setError("请先生成并确认汇报大纲。");
      return;
    }
    if (!hasEnoughPapers) {
      setError(REVIEW_MIN_PAPER_COUNT_ERROR);
      return;
    }

    const abortController = startGeneration();
    setIsGeneratingPpt(true);

    try {
      const result = await generateLiteratureReview(
        {
          ...buildRequestBase(),
          phase: "ppt",
          confirmedOutline: outline.trim(),
          uiPaperCount: paperCount,
        },
        abortController.signal,
      );
      setPptOutline(result.pptOutline ?? "");
      setStatusMessage("PPT 大纲已生成。");
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err instanceof LiteratureError ? err.message : "生成 PPT 大纲失败。");
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsGeneratingPpt(false);
    }
  };

  const handleExport = async () => {
    const content = pptOutline.trim();
    if (!content) {
      setError("暂无可导出的 PPT 大纲。");
      return;
    }

    setError(null);
    setIsExporting(true);

    try {
      const { filename } = await exportLiteratureReview({
        format: "pptx",
        title: topic.trim() || "学术汇报",
        content,
      });
      setStatusMessage(`已导出 ${filename}`);
    } catch (err) {
      setError(err instanceof LiteratureError ? err.message : "导出失败。");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">AI 学术汇报</h1>
            <p className="text-sm text-gray-500">
              基于文献夹中的论文生成可编辑研究大纲与学术汇报 PPT。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/literature/library"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              文献库
            </Link>
            <Link
              href="/literature"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              文献追踪
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {statusMessage && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {statusMessage}
          </p>
        )}

        {!isGenerating &&
          analysisProgress &&
          analysisProgress.failedPapers.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">以下文献未完成全文分析：</p>
              <ul className="mt-1 space-y-1 leading-6">
                {analysisProgress.failedPapers.map((item) => (
                  <li key={`${item.title}:${item.reason}`}>
                    《{item.title}》：{item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

        {isGenerating && (
          <div className="flex items-start justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold text-blue-950">
                {isAnalyzingPapers ? "正在逐篇分析 PDF 全文" : "正在生成内容"}
              </p>
              {isAnalyzingPapers && analysisProgress && (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-blue-700 transition-[width] duration-300"
                      style={{
                        width: `${Math.round(
                          ((analysisProgress.completed + analysisProgress.failed) /
                            Math.max(1, analysisProgress.total)) *
                            100,
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-sm text-blue-900">
                    已完成 {analysisProgress.completed}/{analysisProgress.total} 篇
                    {analysisProgress.failed > 0
                      ? `，失败 ${analysisProgress.failed} 篇`
                      : ""}
                  </p>
                  {analysisProgress.currentTitle && (
                    <p className="truncate text-sm font-medium text-blue-950">
                      正在分析《{analysisProgress.currentTitle}》
                    </p>
                  )}
                  {analysisProgress.lastCompletedTitle && (
                    <p className="truncate text-xs text-blue-700">
                      已完成《{analysisProgress.lastCompletedTitle}》分析
                    </p>
                  )}
                </>
              )}
            </div>
            <button
              type="button"
              onClick={stopGeneration}
              className="shrink-0 rounded-lg bg-blue-950 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-900"
            >
              停止生成
            </button>
          </div>
        )}

        <section className="space-y-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">1. 选择成果类型</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label
              className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                workflowMode === "quick_outline"
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="workflowMode"
                  value="quick_outline"
                  checked={workflowMode === "quick_outline"}
                  disabled={isGenerating}
                  onChange={() => changeWorkflowMode("quick_outline")}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-950">
                    快速大纲
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-gray-600">
                    分析题目、摘要和基础信息，快速生成研究大纲，不读取 PDF 全文。
                  </span>
                </span>
              </div>
            </label>
            <label
              className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                workflowMode === "academic_review"
                  ? "border-blue-600 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  name="workflowMode"
                  value="academic_review"
                  checked={workflowMode === "academic_review"}
                  disabled={isGenerating}
                  onChange={() => changeWorkflowMode("academic_review")}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-950">
                    全文学术汇报
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-gray-600">
                    逐篇分析 PDF 全文并展示进度，生成证据驱动的大纲和 PPT。
                  </span>
                </span>
              </div>
            </label>
          </div>
        </section>

        <section className="space-y-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">2. 选择文献夹</h2>

          <label className="grid gap-2">
            <FieldLabel>文献夹</FieldLabel>
            <select
              value={folderId}
              disabled={isLoadingFolders || isGenerating}
              onChange={(event) => {
                setFolderId(event.target.value);
                setOutline("");
                setLiteratureMatrix([]);
                setMatrixConfirmed(false);
                setThemes("");
                setPptOutline("");
                setAnalysisProgress(null);
              }}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            >
              {folderTree.length === 0 ? (
                <option value="">暂无文献夹</option>
              ) : (
                folderTree.map(({ folder, depth }) => (
                  <option key={folder.id} value={folder.id}>
                    {formatFolderTreeLabel(folder.name, depth)}
                  </option>
                ))
              )}
            </select>
          </label>

          <p className="text-sm text-gray-600">
            当前文献夹共 {paperCount} 篇论文。
          </p>

          {workflowMode === "academic_review" && paperCount > 0 && (
            <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              当前已有 {readablePaperCount}/{paperCount} 篇提取出可供 AI
              阅读的全文；开始分析时会自动尝试从已上传 PDF 恢复其余全文。
            </p>
          )}

          {paperCount > 0 && paperCount < REVIEW_MIN_PAPER_COUNT && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {REVIEW_MIN_PAPER_COUNT_ERROR}
            </p>
          )}
        </section>

        <section className="space-y-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">3. 写作指令</h2>

          <label className="grid gap-2">
            <FieldLabel>AI 模型</FieldLabel>
            <select
              value={model}
              disabled={isGenerating}
              onChange={(event) => changeModel(event.target.value as ReviewModel)}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            >
              {REVIEW_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {option.badge}
                </option>
              ))}
            </select>
            {selectedModel && (
              <span className="text-sm leading-6 text-gray-500">
                {selectedModel.description}
              </span>
            )}
          </label>

          <label className="grid gap-2">
            <FieldLabel>汇报主题</FieldLabel>
            <input
              value={topic}
              disabled={isGenerating}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：大语言模型发展与前景"
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <FieldLabel>写作视角</FieldLabel>
              <select
                value={perspective}
                disabled={isGenerating}
                onChange={(event) =>
                  setPerspective(
                    event.target.value as LiteratureReviewRequest["perspective"],
                  )
                }
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              >
                {REVIEW_PERSPECTIVE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            {perspective === REVIEW_PERSPECTIVE_OPTIONS[7] && (
              <label className="grid gap-2">
                <FieldLabel>自定义视角</FieldLabel>
                <input
                  value={customPerspective}
                  disabled={isGenerating}
                  onChange={(event) => setCustomPerspective(event.target.value)}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                />
              </label>
            )}

            <label className="grid gap-2">
              <FieldLabel>目标读者</FieldLabel>
              <select
                value={targetAudience}
                disabled={isGenerating}
                onChange={(event) =>
                  setTargetAudience(
                    event.target.value as LiteratureReviewRequest["targetAudience"],
                  )
                }
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              >
                {REVIEW_AUDIENCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <FieldLabel>语言</FieldLabel>
              <select
                value={language}
                disabled={isGenerating}
                onChange={(event) =>
                  setLanguage(
                    event.target.value as LiteratureReviewRequest["language"],
                  )
                }
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              >
                {REVIEW_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <FieldLabel>汇报深度</FieldLabel>
              <select
                value={length}
                disabled={isGenerating}
                onChange={(event) =>
                  setLength(event.target.value as LiteratureReviewRequest["length"])
                }
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              >
                {REVIEW_LENGTH_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            {length === REVIEW_LENGTH_OPTIONS[3] && (
              <label className="grid gap-2">
                <FieldLabel>目标页数</FieldLabel>
                <input
                  type="number"
                  min={5}
                  value={customWordCount}
                  disabled={isGenerating}
                  onChange={(event) => setCustomWordCount(event.target.value)}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                />
              </label>
            )}
          </div>

          <fieldset className="space-y-3" disabled={isGenerating}>
            <FieldLabel>必需结构（可多选）</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              {REVIEW_SECTION_OPTIONS.map((section) => (
                <label
                  key={section}
                  className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={requiredSections.includes(section)}
                    onChange={() => toggleSection(section)}
                  />
                  <span>{section}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="grid gap-2">
            <FieldLabel>补充说明</FieldLabel>
            <textarea
              value={additionalInstructions}
              disabled={isGenerating}
              onChange={(event) => setAdditionalInstructions(event.target.value)}
              rows={4}
              placeholder="例如：重点比较不同方法的技术路线，减少泛泛背景介绍。"
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </label>

          <button
            type="button"
            disabled={!canClickGenerateOutline}
            onClick={() => {
              void handleGenerateMatrix();
            }}
            className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            {isAnalyzingPapers
              ? "正在分析文献全文..."
              : isGeneratingOutline
                ? "正在生成文献矩阵..."
                : workflowMode === "academic_review"
                  ? "分析全文并生成文献矩阵"
                  : "生成文献矩阵"}
          </button>
        </section>

        {literatureMatrix.length > 0 && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">
                4. 文献矩阵
              </h2>
              <span className="text-sm text-gray-500">
                共 {literatureMatrix.length} 篇文献
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-[1800px] border-collapse text-left text-sm">
                <thead className="bg-gray-50 text-xs font-semibold text-gray-700">
                  <tr>
                    {[
                      "文献名称",
                      "研究主题",
                      "研究问题",
                      "研究对象",
                      "研究方法",
                      "关键结果",
                      "主要结论",
                      "核心思想",
                      "局限性",
                      "与汇报的关系",
                      "证据状态",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="min-w-40 border-b border-r border-gray-200 px-3 py-3 last:border-r-0"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="align-top text-gray-700">
                  {literatureMatrix.map((row) => (
                    <tr key={row.paperId} className="even:bg-gray-50/60">
                      {[
                        row.citation,
                        row.researchTopic,
                        row.researchProblem,
                        row.researchObject,
                        row.researchMethod,
                        row.keyResults,
                        row.conclusion,
                        row.coreIdea,
                        row.limitations,
                        row.reviewRelation,
                      ].map((value, index) => (
                        <td
                          key={`${row.paperId}-${index}`}
                          className="max-w-64 border-b border-r border-gray-200 px-3 py-3 leading-6 last:border-r-0"
                        >
                          {value}
                        </td>
                      ))}
                      <td className="border-b border-gray-200 px-3 py-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${
                            row.evidenceLevel === "full_text"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {row.evidenceLevel === "full_text"
                            ? "全文已分析"
                            : "仅摘要"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
              <p className="text-sm text-gray-600">
                {matrixConfirmed
                  ? "该矩阵已作为主题归类的证据基础。"
                  : "请检查文献数量、证据状态和关键信息后再继续。"}
              </p>
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => void handleGenerateThemes()}
                className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              >
                {isGeneratingThemes
                  ? "正在归类主题..."
                  : themes
                    ? "重新生成主题归类"
                    : "确认矩阵并生成主题归类"}
              </button>
            </div>
          </section>
        )}

        {themes && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-gray-900">5. 主题归类</h2>
              <p className="mt-1 text-sm text-gray-500">
                只整理主题、共识、分歧和研究空白，不生成论文大纲。
              </p>
            </div>
            <textarea
              value={themes}
              disabled={isGenerating}
              onChange={(event) => {
                setThemes(event.target.value);
                setOutline("");
                setPptOutline("");
              }}
              rows={16}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm leading-6"
            />
            <button
              type="button"
              disabled={isGenerating || !themes.trim()}
              onClick={() => void handleGenerateOutline()}
              className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {isGeneratingOutline ? "正在生成论文大纲..." : "确认主题归类并生成论文大纲"}
            </button>
          </section>
        )}

        {outline && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">6. 确认大纲</h2>
            <textarea
              value={outline}
              disabled={isGenerating}
              onChange={(event) => setOutline(event.target.value)}
              rows={16}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm leading-6"
            />
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => {
                void handleGeneratePpt();
              }}
              className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {isGeneratingPpt ? "正在生成 PPT 大纲..." : "确认大纲并生成 PPT"}
            </button>
          </section>
        )}

        {pptOutline && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">7. PPT 大纲</h2>
            <textarea
              value={pptOutline}
              disabled={isGenerating}
              onChange={(event) => setPptOutline(event.target.value)}
              rows={16}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm leading-6"
            />
            <button
              type="button"
              disabled={isExporting || isGenerating}
              onClick={() => {
                void handleExport();
              }}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              导出 PPTX
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
