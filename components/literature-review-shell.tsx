"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  exportLiteratureReview,
  fetchLiteratureFolders,
  fetchLiteratureLibrary,
  generateLiteratureReview,
  LiteratureError,
} from "@/lib/literature/client";
import {
  REVIEW_AUDIENCE_OPTIONS,
  REVIEW_LANGUAGE_OPTIONS,
  REVIEW_LENGTH_OPTIONS,
  REVIEW_MIN_PAPER_COUNT,
  REVIEW_MIN_PAPER_COUNT_ERROR,
  REVIEW_OUTPUT_TYPE_OPTIONS,
  REVIEW_PERSPECTIVE_OPTIONS,
  REVIEW_SECTION_OPTIONS,
} from "@/lib/literature/review/constants";
import type {
  LiteratureReviewRequest,
  ReviewSection,
} from "@/lib/literature/review/types";
import {
  flattenFolderTree,
  formatFolderTreeLabel,
} from "@/lib/literature/folder-tree";
import type { LiteratureFolder } from "@/lib/literature/types";

const DEFAULT_SECTIONS: ReviewSection[] = [
  "研究背景",
  "研究主题分类",
  "技术路线",
  "代表性文献",
  "当前瓶颈",
  "未来方向",
  "总结",
  "参考文献",
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium text-gray-900">{children}</span>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function LiteratureReviewShell() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const [folders, setFolders] = useState<LiteratureFolder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [paperCount, setPaperCount] = useState(0);
  const [topic, setTopic] = useState("");
  const [perspective, setPerspective] =
    useState<LiteratureReviewRequest["perspective"]>("技术路线综述");
  const [customPerspective, setCustomPerspective] = useState("");
  const [targetAudience, setTargetAudience] =
    useState<LiteratureReviewRequest["targetAudience"]>("导师");
  const [requiredSections, setRequiredSections] =
    useState<ReviewSection[]>(DEFAULT_SECTIONS);
  const [outputType, setOutputType] =
    useState<LiteratureReviewRequest["outputType"]>("综述文章");
  const [language, setLanguage] =
    useState<LiteratureReviewRequest["language"]>("中文");
  const [length, setLength] =
    useState<LiteratureReviewRequest["length"]>("标准版");
  const [customWordCount, setCustomWordCount] = useState("5000");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [outline, setOutline] = useState("");
  const [review, setReview] = useState("");
  const [pptOutline, setPptOutline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoadingFolders, setIsLoadingFolders] = useState(true);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isGeneratingReview, setIsGeneratingReview] = useState(false);
  const [isGeneratingPpt, setIsGeneratingPpt] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const isGenerating =
    isGeneratingOutline || isGeneratingReview || isGeneratingPpt;
  const folderTree = useMemo(() => flattenFolderTree(folders), [folders]);
  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === folderId) ?? null,
    [folders, folderId],
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
        }
      } catch {
        if (!cancelled) {
          setPaperCount(0);
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
      topic: topic.trim(),
      perspective,
      customPerspective:
        perspective === "自定义" ? customPerspective.trim() : undefined,
      targetAudience,
      requiredSections,
      outputType,
      language,
      length,
      customWordCount:
        length === "自定义字数" ? Number(customWordCount) : undefined,
      additionalInstructions: additionalInstructions.trim() || undefined,
    };
  }, [
    additionalInstructions,
    customPerspective,
    customWordCount,
    folderId,
    language,
    length,
    outputType,
    perspective,
    requiredSections,
    selectedFolder,
    targetAudience,
    topic,
  ]);

  const hasEnoughPapers = paperCount >= REVIEW_MIN_PAPER_COUNT;
  const canGenerateOutline =
    Boolean(folderId && topic.trim() && requiredSections.length > 0) &&
    hasEnoughPapers &&
    !isGenerating;

  const assertEnoughPapers = () => {
    if (paperCount < REVIEW_MIN_PAPER_COUNT) {
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
    setIsGeneratingReview(false);
    setIsGeneratingPpt(false);
    setStatusMessage("已停止生成。");
  };

  const toggleSection = (section: ReviewSection) => {
    setRequiredSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  };

  const handleGenerateOutline = async () => {
    if (!assertEnoughPapers()) {
      return;
    }

    const abortController = startGeneration();
    setIsGeneratingOutline(true);

    try {
      const result = await generateLiteratureReview(
        {
          ...buildRequestBase(),
          phase: "outline",
          uiPaperCount: paperCount,
        },
        abortController.signal,
      );
      setOutline(result.outline ?? "");
      setReview("");
      setPptOutline("");
      setStatusMessage("大纲已生成，请确认或编辑后继续。");
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

  const handleGenerateReview = async () => {
    if (!outline.trim()) {
      setError("请先生成并确认大纲。");
      return;
    }
    if (!assertEnoughPapers()) {
      return;
    }

    const abortController = startGeneration();
    setIsGeneratingReview(true);

    try {
      const result = await generateLiteratureReview(
        {
          ...buildRequestBase(),
          phase: "full",
          confirmedOutline: outline.trim(),
          uiPaperCount: paperCount,
        },
        abortController.signal,
      );
      setReview(result.review ?? "");
      setPptOutline("");
      setStatusMessage("综述正文已生成。");
    } catch (err) {
      if (!isAbortError(err)) {
        setError(
          err instanceof LiteratureError ? err.message : "生成综述正文失败。",
        );
      }
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setIsGeneratingReview(false);
    }
  };

  const handleGeneratePpt = async () => {
    if (!review.trim()) {
      setError("请先生成综述正文。");
      return;
    }
    if (!assertEnoughPapers()) {
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
          reviewContent: review.trim(),
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

  const handleExport = async (format: "docx" | "pptx") => {
    const content = format === "docx" ? review.trim() : pptOutline.trim();
    if (!content) {
      setError(
        format === "docx"
          ? "暂无可导出的综述正文。"
          : "暂无可导出的 PPT 大纲。",
      );
      return;
    }

    setError(null);
    setIsExporting(true);

    try {
      const { filename } = await exportLiteratureReview({
        format,
        title: topic.trim() || "文献综述",
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
            <h1 className="text-lg font-semibold text-gray-900">AI 文献综述</h1>
            <p className="text-sm text-gray-500">
              基于文献夹中的论文，按你的写作指令生成可编辑大纲与综述正文。
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

        {isGenerating && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">正在生成内容...</p>
            <button
              type="button"
              onClick={stopGeneration}
              className="rounded-lg bg-amber-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-800"
            >
              停止生成
            </button>
          </div>
        )}

        <section className="space-y-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">1. 选择文献夹</h2>

          <label className="grid gap-2">
            <FieldLabel>文献夹</FieldLabel>
            <select
              value={folderId}
              disabled={isLoadingFolders || isGenerating}
              onChange={(event) => setFolderId(event.target.value)}
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

          {paperCount > 0 && paperCount < REVIEW_MIN_PAPER_COUNT && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {REVIEW_MIN_PAPER_COUNT_ERROR}
            </p>
          )}
        </section>

        <section className="space-y-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">2. 写作指令</h2>

          <label className="grid gap-2">
            <FieldLabel>综述主题</FieldLabel>
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

            {perspective === "自定义" && (
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
              <FieldLabel>输出类型</FieldLabel>
              <select
                value={outputType}
                disabled={isGenerating}
                onChange={(event) =>
                  setOutputType(
                    event.target.value as LiteratureReviewRequest["outputType"],
                  )
                }
                className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
              >
                {REVIEW_OUTPUT_TYPE_OPTIONS.map((option) => (
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
              <FieldLabel>篇幅</FieldLabel>
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

            {length === "自定义字数" && (
              <label className="grid gap-2">
                <FieldLabel>目标字数</FieldLabel>
                <input
                  type="number"
                  min={500}
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
            disabled={!canGenerateOutline}
            onClick={() => {
              void handleGenerateOutline();
            }}
            className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            {isGeneratingOutline ? "正在生成大纲..." : "生成综述大纲"}
          </button>
        </section>

        {outline && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">3. 确认大纲</h2>
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
                void handleGenerateReview();
              }}
              className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {isGeneratingReview ? "正在生成正文..." : "确认并生成综述正文"}
            </button>
          </section>
        )}

        {review && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">4. 综述正文</h2>
            <textarea
              value={review}
              disabled={isGenerating}
              onChange={(event) => setReview(event.target.value)}
              rows={20}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm leading-6"
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={isExporting || isGenerating}
                onClick={() => {
                  void handleExport("docx");
                }}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                导出 DOCX
              </button>
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => {
                  void handleGeneratePpt();
                }}
                className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400"
              >
                {isGeneratingPpt ? "正在生成 PPT 大纲..." : "生成 PPT 大纲"}
              </button>
            </div>
          </section>
        )}

        {pptOutline && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">5. PPT 大纲</h2>
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
                void handleExport("pptx");
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
