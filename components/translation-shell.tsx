"use client";

import { useCallback, useRef, useState } from "react";
import { ResearchPageHeader } from "@/components/research-page-header";
import {
  MAX_DOCX_TRANSLATION_MB,
  OUTPUT_MODE_OPTIONS,
} from "@/lib/translation/constants";
import {
  translateDocxFile,
  TranslationClientError,
  type TranslationFormValues,
  type TranslationUiState,
} from "@/lib/translation/client";
import type { OutputMode } from "@/lib/translation/types";

const STAGE_LABELS: Record<NonNullable<TranslationUiState["stage"]>, string> = {
  idle: "准备翻译",
  uploaded: "文件已上传",
  extracting: "正在提取文本",
  translating: "正在翻译",
  generating: "正在生成输出文件",
  completed: "已完成",
};

export function TranslationShell() {
  const [file, setFile] = useState<File | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>("replace");
  const [glossary, setGlossary] = useState("");
  const [uiState, setUiState] = useState<TranslationUiState>({ stage: "idle" });
  const [isTranslating, setIsTranslating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setUiState({ stage: "idle" });
    event.target.value = "";
  };

  const handleTranslate = useCallback(async () => {
    if (!file || isTranslating) return;

    if (!file.name.toLowerCase().endsWith(".docx")) {
      setUiState({
        stage: "idle",
        error: "请上传 .docx 文件。",
      });
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsTranslating(true);
    setUiState({ stage: "uploaded" });

    const values: TranslationFormValues = {
      file,
      sourceLanguage: "chinese",
      targetLanguage: "english",
      outputMode,
      style: "academic",
      glossary: glossary.trim() || undefined,
    };

    try {
      await translateDocxFile(values, {
        signal: abortController.signal,
        onProgress: setUiState,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setUiState({ stage: "idle" });
        return;
      }

      const message =
        error instanceof TranslationClientError
          ? error.message
          : "文档翻译失败，请重试。";

      setUiState({ stage: "idle", error: message });
    } finally {
      setIsTranslating(false);
      abortControllerRef.current = null;
    }
  }, [file, glossary, isTranslating, outputMode]);

  const handleStop = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsTranslating(false);
    setUiState({ stage: "idle" });
  };

  const progressLabel =
    uiState.stage === "translating" &&
    uiState.batch &&
    uiState.totalBatches
      ? `${STAGE_LABELS.translating} 第 ${uiState.batch}/${uiState.totalBatches} 批`
      : STAGE_LABELS[uiState.stage];

  return (
    <div className="min-h-dvh bg-white">
      <ResearchPageHeader
        title="学术翻译"
        description="将中文 Word 文档翻译为专业英文，并保留原有文档结构。"
        maxWidth="4xl"
      />

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <section className="border-b border-gray-200 pb-5">
          <h2 className="text-base font-semibold text-gray-900">中文 → 英文</h2>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            专业术语、数字、单位、公式、引用编号和标准缩写将尽可能保持准确一致。
          </p>
        </section>
        <div className="space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div>
            <label
              htmlFor="docx-upload"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              Word 文档（.docx）
            </label>
            <input
              id="docx-upload"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              disabled={isTranslating}
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-700 file:mr-4 file:rounded-lg file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800"
            />
            <p className="mt-2 text-xs text-gray-400">
              最大 {MAX_DOCX_TRANSLATION_MB}MB。尽可能保留段落、标题、列表和表格单元格。
            </p>
            {file && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <p>
                  已选择：<span className="font-medium">{file.name}</span>
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  文件大小 {(file.size / 1024 / 1024).toFixed(2)} MB。系统按段落分批翻译；重复翻译会产生新的 AI 调用。
                </p>
              </div>
            )}
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-gray-700">
              选择翻译结果
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              {OUTPUT_MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-4 text-sm transition-colors ${
                    outputMode === option.value
                      ? "border-blue-600 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="output-mode"
                    value={option.value}
                    checked={outputMode === option.value}
                    disabled={isTranslating}
                    onChange={() => setOutputMode(option.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-gray-900">
                      {option.label}
                    </span>
                    <span className="block text-gray-500">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <label className="grid gap-2">
            <span className="text-sm font-medium text-gray-700">
              固定术语（可选）
            </span>
            <textarea
              value={glossary}
              disabled={isTranslating}
              onChange={(event) => setGlossary(event.target.value)}
              rows={4}
              maxLength={10_000}
              placeholder={"每行一个术语，例如：\n有机催化 = organocatalysis\n转化率 = conversion"}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm leading-6 outline-none focus:border-blue-500"
            />
            <span className="text-xs text-gray-500">
              锁定后的译法会在全文中优先保持一致。
            </span>
          </label>

          <div className="rounded-2xl bg-gray-50 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">{progressLabel}</p>
            {uiState.stage === "completed" && uiState.filename && (
              <p className="mt-1 text-sm text-gray-600">
                已下载 {uiState.filename}。已翻译 {uiState.translatedCount} 段，跳过{" "}
                {uiState.skippedCount} 段。
              </p>
            )}
            {uiState.stage === "completed" &&
              (uiState.qualityWarnings?.length ?? 0) === 0 && (
                <p className="mt-1 text-sm text-emerald-700">
                  完整性检查未发现数字、单位或漏译风险。
                </p>
              )}
          </div>

          {uiState.qualityWarnings && uiState.qualityWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">翻译完成，但建议检查以下内容：</p>
              <ul className="mt-2 space-y-1">
                {uiState.qualityWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {uiState.error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {uiState.error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void handleTranslate()}
              disabled={!file || isTranslating}
              className="min-w-0 flex-1 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {isTranslating
                ? "正在翻译…"
                : outputMode === "bilingual"
                  ? "生成中英对照 Word"
                  : "生成全英文 Word"}
            </button>
            {isTranslating && (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-xl border border-gray-300 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                停止翻译
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
