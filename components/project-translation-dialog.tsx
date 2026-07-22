"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL_TIER,
  getChatModelOption,
  type ChatModelTier,
} from "@/lib/ai/chat-models";
import {
  fetchDesktopLocalFileBlob,
  type LocalPdfFile,
} from "@/lib/desktop/connection";
import {
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

const STAGE_LABELS: Record<TranslationUiState["stage"], string> = {
  idle: "准备翻译",
  uploaded: "文件已读取",
  extracting: "正在提取文本",
  translating: "正在翻译",
  generating: "正在生成 Word 文档",
  completed: "已完成",
};

type ProjectTranslationDownload = {
  id: string;
  filename: string;
  url: string;
  translatedCount: number;
  skippedCount: number;
  qualityWarnings: string[];
};

type ProjectTranslationDialogProps = {
  files: LocalPdfFile[];
  initialOutputMode: OutputMode;
  onClose: () => void;
};

export function ProjectTranslationDialog({
  files,
  initialOutputMode,
  onClose,
}: ProjectTranslationDialogProps) {
  const [sourceLanguage, setSourceLanguage] =
    useState<SourceLanguage>("chinese");
  const [targetLanguage, setTargetLanguage] =
    useState<TargetLanguage>("english");
  const [outputMode, setOutputMode] = useState<OutputMode>(initialOutputMode);
  const [style, setStyle] = useState<TranslationStyle>("academic");
  const [modelTier, setModelTier] = useState<ChatModelTier>(
    DEFAULT_CHAT_MODEL_TIER,
  );
  const [glossary, setGlossary] = useState("");
  const [uiState, setUiState] = useState<TranslationUiState>({ stage: "idle" });
  const [currentFileName, setCurrentFileName] = useState("");
  const [downloads, setDownloads] = useState<ProjectTranslationDownload[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const downloadsRef = useRef<ProjectTranslationDownload[]>([]);

  useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      downloadsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  const progressLabel =
    uiState.stage === "translating" &&
    uiState.batch &&
    uiState.totalBatches
      ? `${STAGE_LABELS.translating} 第 ${uiState.batch}/${uiState.totalBatches} 批`
      : STAGE_LABELS[uiState.stage];

  const handleModelTierChange = (tier: ChatModelTier) => {
    const option = getChatModelOption(tier);
    if (option.expensive && option.costWarning && tier !== modelTier) {
      const confirmed = window.confirm(option.costWarning);
      if (!confirmed) return;
    }
    setModelTier(tier);
  };

  const runTranslation = async () => {
    if (isTranslating || files.length === 0) return;

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setIsTranslating(true);
    setUiState({ stage: "uploaded" });
    setDownloads((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.url));
      return [];
    });

    try {
      for (const [index, localFileRef] of files.entries()) {
        setCurrentFileName(`正在准备 ${index + 1}/${files.length}：${localFileRef.name}`);
        const file = await fetchDesktopLocalFileBlob(localFileRef);
        const values: TranslationFormValues = {
          file,
          sourceLanguage,
          targetLanguage,
          outputMode,
          style,
          modelTier,
          glossary: glossary.trim() || undefined,
        };

        const result = await translateDocxFile(values, {
          signal: abortController.signal,
          onProgress: (state) => {
            setUiState(state);
            setCurrentFileName(`正在翻译 ${index + 1}/${files.length}：${localFileRef.name}`);
          },
        });

        setDownloads((current) => [
          ...current,
          {
            id: `${localFileRef.id}-${Date.now()}`,
            filename: result.filename,
            url: URL.createObjectURL(result.blob),
            translatedCount: result.translatedCount,
            skippedCount: result.skippedCount,
            qualityWarnings: result.qualityWarnings,
          },
        ]);
      }

      setCurrentFileName(`已生成 ${files.length} 个翻译文档，请点击下方链接下载。`);
      setUiState({ stage: "completed" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setUiState({ stage: "idle" });
        setCurrentFileName("翻译已停止。");
        return;
      }

      setUiState({
        stage: "idle",
        error:
          error instanceof TranslationClientError || error instanceof Error
            ? error.message
            : "文档翻译失败，请重试。",
      });
    } finally {
      setIsTranslating(false);
      abortControllerRef.current = null;
    }
  };

  const stopTranslation = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsTranslating(false);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4">
      <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-gray-950">项目文件翻译</h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              与“学术翻译”共用同一套翻译逻辑。完成后只生成下载链接，不会自动下载。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isTranslating}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 disabled:opacity-50"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <p className="font-semibold text-gray-900">已选择 {files.length} 个 Word 文档</p>
          <p className="mt-1 line-clamp-2 text-xs text-gray-500">
            {files.map((file) => file.name).join("、")}
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-gray-700">
            原文语言
            <select
              value={sourceLanguage}
              disabled={isTranslating}
              onChange={(event) =>
                setSourceLanguage(event.target.value as SourceLanguage)
              }
              className="h-11 rounded-xl border border-gray-200 px-3 outline-none focus:border-blue-500"
            >
              {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-gray-700">
            目标语言
            <select
              value={targetLanguage}
              disabled={isTranslating}
              onChange={(event) =>
                setTargetLanguage(event.target.value as TargetLanguage)
              }
              className="h-11 rounded-xl border border-gray-200 px-3 outline-none focus:border-blue-500"
            >
              {TARGET_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-gray-700">
            翻译风格
            <select
              value={style}
              disabled={isTranslating}
              onChange={(event) =>
                setStyle(event.target.value as TranslationStyle)
              }
              className="h-11 rounded-xl border border-gray-200 px-3 outline-none focus:border-blue-500"
            >
              {STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="block text-sm font-medium text-gray-700">
              输出结果
            </span>
            <div className="mt-2 grid gap-2">
              {OUTPUT_MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    outputMode === option.value
                      ? "border-blue-600 bg-blue-50"
                      : "border-gray-200"
                  }`}
                >
                  <input
                    type="radio"
                    name="project-translation-output"
                    value={option.value}
                    checked={outputMode === option.value}
                    disabled={isTranslating}
                    onChange={() => setOutputMode(option.value)}
                  />
                  <span className="font-medium text-gray-900">{option.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <span className="block text-sm font-medium text-gray-700">
            翻译模型
          </span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {CHAT_MODEL_OPTIONS.map((option) => (
              <label
                key={option.tier}
                className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-3 text-sm ${
                  modelTier === option.tier
                    ? "border-blue-600 bg-blue-50"
                    : "border-gray-200"
                }`}
              >
                <input
                  type="radio"
                  name="project-translation-model"
                  value={option.tier}
                  checked={modelTier === option.tier}
                  disabled={isTranslating}
                  onChange={() => handleModelTierChange(option.tier)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-semibold text-gray-900">
                    {option.label}
                  </span>
                  <span className="block text-xs leading-5 text-gray-500">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <label className="mt-4 grid gap-2">
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
        </label>

        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3">
          <p className="text-sm font-semibold text-gray-900">{progressLabel}</p>
          {currentFileName && (
            <p className="mt-1 text-sm leading-6 text-gray-600">{currentFileName}</p>
          )}
          {uiState.error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {uiState.error}
            </p>
          )}
        </div>

        {downloads.length > 0 && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-sm font-bold text-emerald-900">可下载文件</p>
            <div className="mt-2 space-y-2">
              {downloads.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-emerald-100 bg-white px-3 py-2"
                >
                  <a
                    href={item.url}
                    download={item.filename}
                    className="text-sm font-bold text-blue-700 hover:text-blue-900"
                  >
                    下载 {item.filename}
                  </a>
                  <p className="mt-1 text-xs text-gray-500">
                    已翻译 {item.translatedCount} 段，跳过 {item.skippedCount} 段。
                    {item.qualityWarnings.length > 0
                      ? " 建议下载后检查数字、单位和术语一致性。"
                      : " 完整性检查未发现明显风险。"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {isTranslating && (
            <button
              type="button"
              onClick={stopTranslation}
              className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              停止翻译
            </button>
          )}
          <button
            type="button"
            onClick={() => void runTranslation()}
            disabled={isTranslating || files.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-gray-950 px-4 py-2 text-sm font-bold text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400"
          >
            {isTranslating && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {isTranslating ? "正在翻译" : "开始翻译"}
          </button>
        </div>
      </section>
    </div>
  );
}
