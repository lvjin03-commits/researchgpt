"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import {
  MAX_DOCX_TRANSLATION_MB,
  OUTPUT_MODE_OPTIONS,
  SOURCE_LANGUAGE_OPTIONS,
  STYLE_OPTIONS,
  TARGET_LANGUAGE_OPTIONS,
} from "@/lib/translation/constants";
import {
  translateDocxFile,
  TranslationClientError,
  type TranslationFormValues,
  type TranslationUiState,
} from "@/lib/translation/client";
import type {
  OutputMode,
  SourceLanguage,
  TargetLanguage,
  TranslationStyle,
} from "@/lib/translation/types";

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
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>("auto");
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>("english");
  const [outputMode, setOutputMode] = useState<OutputMode>("replace");
  const [style, setStyle] = useState<TranslationStyle>("general");
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
      sourceLanguage,
      targetLanguage,
      outputMode,
      style,
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
  }, [file, isTranslating, outputMode, sourceLanguage, style, targetLanguage]);

  const progressLabel =
    uiState.stage === "translating" &&
    uiState.batch &&
    uiState.totalBatches
      ? `${STAGE_LABELS.translating} 第 ${uiState.batch}/${uiState.totalBatches} 批`
      : STAGE_LABELS[uiState.stage];

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              文档翻译
            </h1>
            <p className="text-sm text-gray-500">
              上传 Word 文档并下载翻译后的 .docx 文件。
            </p>
          </div>
          <Link
            href="/chat"
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            返回对话
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
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
              <p className="mt-2 text-sm text-gray-600">
                已选择：<span className="font-medium">{file.name}</span>
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="source-language"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                源语言
              </label>
              <select
                id="source-language"
                value={sourceLanguage}
                disabled={isTranslating}
                onChange={(event) =>
                  setSourceLanguage(event.target.value as SourceLanguage)
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              >
                {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="target-language"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                目标语言
              </label>
              <select
                id="target-language"
                value={targetLanguage}
                disabled={isTranslating}
                onChange={(event) =>
                  setTargetLanguage(event.target.value as TargetLanguage)
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              >
                {TARGET_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-gray-700">
              输出模式
            </span>
            <div className="space-y-2">
              {OUTPUT_MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 px-3 py-3 text-sm hover:bg-gray-50"
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

          <div>
            <label
              htmlFor="translation-style"
              className="mb-2 block text-sm font-medium text-gray-700"
            >
              风格
            </label>
            <select
              id="translation-style"
              value={style}
              disabled={isTranslating}
              onChange={(event) =>
                setStyle(event.target.value as TranslationStyle)
              }
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
            >
              {STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl bg-gray-50 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">{progressLabel}</p>
            {uiState.stage === "completed" && uiState.filename && (
              <p className="mt-1 text-sm text-gray-600">
                已下载 {uiState.filename}。已翻译 {uiState.translatedCount} 段，跳过{" "}
                {uiState.skippedCount} 段。
              </p>
            )}
          </div>

          {uiState.error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {uiState.error}
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              void handleTranslate();
            }}
            disabled={!file || isTranslating}
            className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
          >
            {isTranslating ? "正在翻译…" : "翻译文档"}
          </button>
        </div>
      </main>
    </div>
  );
}
