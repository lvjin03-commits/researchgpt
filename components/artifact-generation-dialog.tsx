"use client";

import {
  AlertTriangle,
  Check,
  FileText,
  Image as ImageIcon,
  Presentation,
  Table2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  ARTIFACT_TEMPLATES,
  planArtifact,
  type ArtifactTemplateId,
} from "@/lib/export/artifact-planner";
import { exportContent, ExportError } from "@/lib/export/client";
import type { ExportFormat } from "@/lib/export/types";

type ArtifactGenerationDialogProps = {
  open: boolean;
  title: string;
  content: string;
  onClose: () => void;
};

const PRIMARY_FORMATS: Array<{
  format: ExportFormat;
  label: string;
  description: string;
  icon: typeof FileText;
}> = [
  { format: "docx", label: "Word", description: "专业文档", icon: FileText },
  {
    format: "pptx",
    label: "PowerPoint",
    description: "结构化演示",
    icon: Presentation,
  },
  { format: "xlsx", label: "Excel", description: "表格与矩阵", icon: Table2 },
  { format: "pdf", label: "PDF", description: "阅读与打印", icon: FileText },
  { format: "png", label: "PNG", description: "成果摘要图", icon: ImageIcon },
  { format: "svg", label: "SVG", description: "可编辑矢量图", icon: ImageIcon },
];

const SECONDARY_FORMATS: Array<{
  format: ExportFormat;
  label: string;
}> = [
  { format: "md", label: "Markdown" },
  { format: "txt", label: "纯文本" },
  { format: "json", label: "JSON" },
];

function PreviewCard({
  title,
  lines,
  index,
  accent,
}: {
  title: string;
  lines: string[];
  index: number;
  accent: string;
}) {
  return (
    <article className="relative aspect-[4/3] overflow-hidden border border-gray-200 bg-white p-3 shadow-sm">
      <span
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: accent }}
      />
      <p className="mt-1 line-clamp-2 text-xs font-bold leading-4 text-gray-950">
        {title}
      </p>
      <div className="mt-3 space-y-2">
        {lines.slice(0, 4).map((line, lineIndex) => (
          <div key={`${line}-${lineIndex}`} className="flex gap-1.5">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0"
              style={{ backgroundColor: accent }}
            />
            <span className="line-clamp-2 text-[10px] leading-4 text-gray-600">
              {line}
            </span>
          </div>
        ))}
      </div>
      <span className="absolute bottom-2 right-2 text-[9px] text-gray-400">
        {index + 1}
      </span>
    </article>
  );
}

export function ArtifactGenerationDialog({
  open,
  title,
  content,
  onClose,
}: ArtifactGenerationDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("docx");
  const [templateId, setTemplateId] =
    useState<ArtifactTemplateId>("academic");
  const [autoRepair, setAutoRepair] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(
    () => planArtifact(title, content, format),
    [content, format, title],
  );
  const template =
    ARTIFACT_TEMPLATES.find((item) => item.id === templateId) ??
    ARTIFACT_TEMPLATES[0];
  const previewItems = useMemo(() => {
    if (format === "xlsx") {
      return [
        {
          title: "成果概览",
          lines: ["成果名称", "摘要", "章节内容"],
        },
        ...plan.artifact.tables.map((table) => ({
          title: table.title,
          lines: [
            table.headers.join(" · "),
            `${table.rows.length} 条数据记录`,
          ],
        })),
      ];
    }
    return [
      {
        title: plan.artifact.title,
        lines: [plan.artifact.summary],
      },
      ...plan.artifact.sections.map((section) => ({
        title: section.title,
        lines: [...section.paragraphs, ...section.bullets],
      })),
    ];
  }, [format, plan]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isGenerating) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isGenerating, onClose, open]);

  if (!open) return null;

  const generate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      await exportContent({
        format,
        title,
        content,
        metadata: {
          source: "assistant-message",
          artifactPlanVersion: 1,
          templateId,
          autoRepair,
          qualityScore: plan.score,
        },
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof ExportError ? err.message : "文件生成失败，请重试。",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="生成成果文件"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !isGenerating) onClose();
      }}
    >
      <div className="flex max-h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-950">生成成果文件</h2>
            <p className="mt-1 text-sm text-gray-500">
              规划结构、检查排版并预览后生成真实文件。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isGenerating}
            aria-label="关闭"
            className="inline-flex h-9 w-9 items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[390px_minmax(0,1fr)] lg:overflow-hidden">
          <div className="space-y-6 border-r border-gray-200 p-5 lg:overflow-y-auto">
            <section>
              <h3 className="text-sm font-bold text-gray-950">1. 成果类型</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {PRIMARY_FORMATS.map((option) => {
                  const Icon = option.icon;
                  const selected = format === option.format;
                  return (
                    <button
                      key={option.format}
                      type="button"
                      onClick={() => setFormat(option.format)}
                      className={`flex min-h-16 items-center gap-3 border px-3 text-left ${
                        selected
                          ? "border-blue-600 bg-blue-50 text-blue-950"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span>
                        <span className="block text-sm font-bold">
                          {option.label}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {option.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {SECONDARY_FORMATS.map((option) => (
                  <button
                    key={option.format}
                    type="button"
                    onClick={() => setFormat(option.format)}
                    className={`border px-3 py-1.5 text-xs font-semibold ${
                      format === option.format
                        ? "border-blue-600 bg-blue-50 text-blue-900"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-gray-950">2. 选择模板</h3>
              <div className="mt-3 space-y-2">
                {ARTIFACT_TEMPLATES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTemplateId(item.id)}
                    className={`flex w-full items-start gap-3 border p-3 text-left ${
                      templateId === item.id
                        ? "border-blue-600 bg-blue-50"
                        : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className="mt-1 h-5 w-5 shrink-0 border border-black/10"
                      style={{ backgroundColor: item.accent }}
                    />
                    <span>
                      <span className="block text-sm font-bold text-gray-950">
                        {item.name}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-gray-500">
                        {item.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-bold text-gray-950">3. 排版检查</h3>
              <div className="mt-3 border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-800">
                    质量评分
                  </span>
                  <span className="text-sm font-bold text-emerald-700">
                    {plan.score}/100
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  预计 {plan.estimatedUnits} {plan.unitLabel}
                </p>
                <div className="mt-3 space-y-2">
                  {plan.issues.length === 0 ? (
                    <p className="flex items-center gap-2 text-xs text-emerald-700">
                      <Check className="h-4 w-4" />
                      未发现明显结构和密度问题
                    </p>
                  ) : (
                    plan.issues.map((issue, index) => (
                      <div key={`${issue.message}-${index}`}>
                        <p className="flex items-start gap-2 text-xs font-medium text-amber-800">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          {issue.message}
                        </p>
                        <p className="ml-5 mt-1 text-xs leading-5 text-gray-500">
                          {issue.repair}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-3 border border-gray-200 p-3">
                <input
                  type="checkbox"
                  checked={autoRepair}
                  onChange={(event) => setAutoRepair(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-bold text-gray-900">
                    自动排版返修
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-gray-500">
                    自动压缩过长要点、控制页面密度并应用安全字号。
                  </span>
                </span>
              </label>
            </section>
          </div>

          <div className="min-h-0 bg-gray-100 p-5 lg:overflow-y-auto">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-gray-950">逐页结构预览</h3>
                <p className="mt-1 text-xs text-gray-500">
                  展示页面结构和内容分配，最终文件会应用完整字体与版式。
                </p>
              </div>
              <span className="bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">
                {template.name} · {format.toUpperCase()}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {previewItems.slice(0, 12).map((item, index) => (
                <PreviewCard
                  key={`${item.title}-${index}`}
                  title={item.title}
                  lines={item.lines}
                  index={index}
                  accent={template.accent}
                />
              ))}
            </div>
            {previewItems.length > 12 && (
              <p className="mt-4 text-center text-xs text-gray-500">
                另有 {previewItems.length - 12} 个页面或工作表将在文件中生成。
              </p>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-500">
            自动返修只调整排版密度，不修改数据和证据结论。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={isGenerating}
              className="bg-blue-700 px-5 py-2 text-sm font-bold text-white hover:bg-blue-800 disabled:bg-gray-300"
            >
              {isGenerating
                ? "正在生成并检查…"
                : `生成 ${format.toUpperCase()}`}
            </button>
          </div>
          {error && (
            <p className="w-full text-right text-xs text-red-600">{error}</p>
          )}
        </footer>
      </div>
    </div>
  );
}
