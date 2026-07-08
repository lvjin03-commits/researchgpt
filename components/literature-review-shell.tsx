"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  return (
    <span className="text-sm font-medium text-gray-900">{children}</span>
  );
}

export function LiteratureReviewShell() {
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

  useEffect(() => {
    void (async () => {
      try {
        const loadedFolders = await fetchLiteratureFolders();
        setFolders(loadedFolders);
        if (loadedFolders[0]) {
          setFolderId(loadedFolders[0].id);
        }
      } catch (err) {
        const message =
          err instanceof LiteratureError ? err.message : "加载文献夹失败。";
        setError(message);
      } finally {
        setIsLoadingFolders(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!folderId) {
      setPaperCount(0);
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

  const buildRequestBase = useCallback((): Omit<LiteratureReviewRequest, "phase"> => {
    return {
      folderId,
      topic: topic.trim(),
      perspective,
      customPerspective:
        perspective === "自定义" ? customPerspective.trim() : undefined,
      targetAudience,
      requiredSections,
      outputType,
      language,
      length,
      customWordCount: length === "自定义字数" ? Number(customWordCount) : undefined,
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
    targetAudience,
    topic,
  ]);

  const hasEnoughPapers = paperCount >= REVIEW_MIN_PAPER_COUNT;

  const canGenerateOutline = useMemo(
    () =>
      Boolean(
        folderId && topic.trim() && requiredSections.length > 0 && hasEnoughPapers,
      ),
    [folderId, hasEnoughPapers, requiredSections.length, topic],
  );

  const toggleSection = (section: ReviewSection) => {
    setRequiredSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  };

  const assertEnoughPapers = () => {
    if (paperCount < REVIEW_MIN_PAPER_COUNT) {
      setError(REVIEW_MIN_PAPER_COUNT_ERROR);
      return false;
    }
    return true;
  };

  const handleGenerateOutline = async () => {
    if (!assertEnoughPapers()) {
      return;
    }

    setError(null);
    setStatusMessage(null);
    setIsGeneratingOutline(true);

    try {
      const result = await generateLiteratureReview({
        ...buildRequestBase(),
        phase: "outline",
      });
      setOutline(result.outline ?? "");
      setReview("");
      setPptOutline("");
      setStatusMessage("大纲已生成，请确认或编辑后继续。");
    } catch (err) {
      const message =
        err instanceof LiteratureError ? err.message : "生成大纲失败。";
      setError(message);
    } finally {
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

    setError(null);
    setStatusMessage(null);
    setIsGeneratingReview(true);

    try {
      const result = await generateLiteratureReview({
        ...buildRequestBase(),
        phase: "full",
        confirmedOutline: outline.trim(),
      });
      setReview(result.review ?? "");
      setPptOutline("");
      setStatusMessage("综述正文已生成。");
    } catch (err) {
      const message =
        err instanceof LiteratureError ? err.message : "生成综述正文失败。";
      setError(message);
    } finally {
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

    setError(null);
    setStatusMessage(null);
    setIsGeneratingPpt(true);

    try {
      const result = await generateLiteratureReview({
        ...buildRequestBase(),
        phase: "ppt",
        confirmedOutline: outline.trim(),
        reviewContent: review.trim(),
      });
      setPptOutline(result.pptOutline ?? "");
      setStatusMessage("PPT 大纲已生成。");
    } catch (err) {
      const message =
        err instanceof LiteratureError ? err.message : "生成 PPT 大纲失败。";
      setError(message);
    } finally {
      setIsGeneratingPpt(false);
    }
  };

  const handleExport = async (format: "docx" | "pptx") => {
    const content = format === "docx" ? review.trim() : pptOutline.trim();
    if (!content) {
      setError(format === "docx" ? "暂无可导出的综述正文。" : "暂无可导出的 PPT 大纲。");
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
      const message = err instanceof LiteratureError ? err.message : "导出失败。";
      setError(message);
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

        <section className="space-y-5 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">1. 选择文献夹</h2>

          <label className="grid gap-2">
            <FieldLabel>文献夹</FieldLabel>
            <select
              value={folderId}
              disabled={isLoadingFolders}
              onChange={(event) => setFolderId(event.target.value)}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            >
              {folders.length === 0 ? (
                <option value="">暂无文献夹</option>
              ) : (
                folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <p className="text-sm text-gray-600">当前文献夹共 {paperCount} 篇论文。</p>

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
              onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：工程菌株代谢工程研究进展"
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2">
              <FieldLabel>写作视角</FieldLabel>
              <select
                value={perspective}
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
                  onChange={(event) => setCustomPerspective(event.target.value)}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                />
              </label>
            )}

            <label className="grid gap-2">
              <FieldLabel>目标读者</FieldLabel>
              <select
                value={targetAudience}
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
                  onChange={(event) => setCustomWordCount(event.target.value)}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
                />
              </label>
            )}
          </div>

          <fieldset className="space-y-3">
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
              onChange={(event) => setAdditionalInstructions(event.target.value)}
              rows={4}
              placeholder="例如：重点比较不同工程菌株的构建策略，不要泛泛介绍背景，重点分析瓶颈和未来方向。"
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
            />
          </label>

          <button
            type="button"
            disabled={!canGenerateOutline || isGeneratingOutline}
            onClick={() => {
              void handleGenerateOutline();
            }}
            className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            {isGeneratingOutline ? "正在生成大纲…" : "生成综述大纲"}
          </button>
        </section>

        {outline && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">3. 确认大纲</h2>
            <textarea
              value={outline}
              onChange={(event) => setOutline(event.target.value)}
              rows={16}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm leading-6"
            />
            <button
              type="button"
              disabled={isGeneratingReview}
              onClick={() => {
                void handleGenerateReview();
              }}
              className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {isGeneratingReview ? "正在生成正文…" : "确认并生成综述正文"}
            </button>
          </section>
        )}

        {review && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">4. 综述正文</h2>
            <textarea
              value={review}
              onChange={(event) => setReview(event.target.value)}
              rows={20}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm leading-6"
            />
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => {
                  void handleExport("docx");
                }}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                导出 DOCX
              </button>
              <button
                type="button"
                disabled={isGeneratingPpt}
                onClick={() => {
                  void handleGeneratePpt();
                }}
                className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400"
              >
                {isGeneratingPpt ? "正在生成 PPT 大纲…" : "生成 PPT 大纲"}
              </button>
            </div>
          </section>
        )}

        {pptOutline && (
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">5. PPT 大纲</h2>
            <textarea
              value={pptOutline}
              onChange={(event) => setPptOutline(event.target.value)}
              rows={16}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-sm leading-6"
            />
            <button
              type="button"
              disabled={isExporting}
              onClick={() => {
                void handleExport("pptx");
              }}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              导出 PPTX
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
