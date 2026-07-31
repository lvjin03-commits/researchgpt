"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  ClipboardCopy,
  Download,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import type { DocumentJobSnapshot } from "@/lib/document-v2/runtime/contracts";
import { STAGE_LABELS } from "@/lib/document-v2/runtime/contracts";
import type { DocumentJobDiagnostics } from "@/lib/document-v2/diagnostics/contracts";

type Props = {
  snapshot: DocumentJobSnapshot;
  onCancel?: () => void;
  onResume?: () => void;
  busy?: boolean;
};

export function DocumentV2JobProgress({
  snapshot,
  onCancel,
  onResume,
  busy = false,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticMessage, setDiagnosticMessage] = useState<string>();
  const { job, events } = snapshot;
  const active = ["queued", "running", "cancelling"].includes(job.status);
  const canResume =
    job.resumable && ["paused", "failed", "cancelled"].includes(job.status);

  const loadDiagnostics = async () => {
    const response = await fetch(
      `/api/document-v2/jobs/${job.jobId}/diagnostics`,
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
    const payload = (await response.json()) as
      | DocumentJobDiagnostics
      | { error?: string };
    if (!response.ok || !("identity" in payload)) {
      throw new Error(
        "error" in payload && payload.error
          ? payload.error
          : "无法读取诊断报告。",
      );
    }
    return payload;
  };

  const copyDiagnostics = async () => {
    setDiagnosticBusy(true);
    setDiagnosticMessage(undefined);
    try {
      const diagnostics = await loadDiagnostics();
      await navigator.clipboard.writeText(diagnostics.humanReadableReport);
      setDiagnosticMessage("诊断报告已复制。");
    } catch (error) {
      setDiagnosticMessage(
        error instanceof Error ? error.message : "复制诊断报告失败。",
      );
    } finally {
      setDiagnosticBusy(false);
    }
  };

  const downloadDiagnostics = async () => {
    setDiagnosticBusy(true);
    setDiagnosticMessage(undefined);
    try {
      const diagnostics = await loadDiagnostics();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(diagnostics, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `document-v2-diagnostics-${job.jobId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDiagnosticMessage("诊断JSON已下载。");
    } catch (error) {
      setDiagnosticMessage(
        error instanceof Error ? error.message : "下载诊断JSON失败。",
      );
    } finally {
      setDiagnosticBusy(false);
    }
  };

  return (
    <section
      aria-label="文档生成进度"
      className="rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-sm"
    >
      <div className="flex items-start gap-3">
        {job.status === "completed" ? (
          <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
        ) : job.status === "failed" ? (
          <AlertCircle className="mt-0.5 size-5 text-red-600" />
        ) : (
          <LoaderCircle className="mt-0.5 size-5 animate-spin text-blue-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">{STAGE_LABELS[job.stage]}</p>
            <span className="text-sm tabular-nums text-neutral-500">
              {job.progress}%
            </span>
          </div>
          <div
            aria-label={`完成 ${job.progress}%`}
            className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress}
          >
            <div
              className="h-full rounded-full bg-blue-600 transition-[width]"
              style={{ width: `${job.progress}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            已完成 {job.completedComponents}/{job.totalComponents} 个文档部分
          </p>
          {job.error ? (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
              {job.error.userMessage}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {job.status === "completed" && job.artifactId ? (
          <a
            href={`/api/download/${job.artifactId}`}
            className="inline-flex items-center rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white"
          >
            下载 Word 文档
          </a>
        ) : null}
        {active && onCancel ? (
          <button
            type="button"
            disabled={busy || job.status === "cancelling"}
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            <CircleStop className="size-4" />
            {job.status === "cancelling" ? "正在停止" : "停止任务"}
          </button>
        ) : null}
        {canResume && onResume ? (
          <button
            type="button"
            disabled={busy}
            onClick={onResume}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            <RotateCcw className="size-4" />
            从上次进度继续
          </button>
        ) : null}
        <button
          type="button"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((value) => !value)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-neutral-600"
        >
          查看运行详情
          <ChevronDown
            className={`size-4 transition-transform ${showDetails ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {showDetails ? (
        <div className="mt-3 border-t border-neutral-100 pt-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={diagnosticBusy}
              onClick={() => void copyDiagnostics()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 disabled:opacity-50"
            >
              <ClipboardCopy className="size-3.5" />
              复制诊断报告
            </button>
            <button
              type="button"
              disabled={diagnosticBusy}
              onClick={() => void downloadDiagnostics()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 disabled:opacity-50"
            >
              <Download className="size-3.5" />
              下载诊断JSON
            </button>
            {diagnosticMessage ? (
              <span className="text-xs text-neutral-500" role="status">
                {diagnosticMessage}
              </span>
            ) : null}
          </div>
          <ol className="space-y-2">
            {events.map((event) => (
            <li key={event.eventId} className="flex gap-2 text-sm">
              <span
                className={`mt-1.5 size-2 shrink-0 rounded-full ${
                  event.status === "failed"
                    ? "bg-red-500"
                    : event.status === "succeeded"
                      ? "bg-emerald-500"
                      : "bg-blue-500"
                }`}
              />
              <div className="min-w-0">
                <p>{event.message}</p>
                <p className="text-xs text-neutral-500">
                  {STAGE_LABELS[event.stage]}
                  {event.attempt ? ` · 第 ${event.attempt} 次` : ""}
                  {typeof event.durationMs === "number"
                    ? ` · ${(event.durationMs / 1000).toFixed(1)} 秒`
                    : ""}
                </p>
                <p className="mt-0.5 text-xs text-neutral-400">
                  {new Date(event.createdAt).toLocaleString("zh-CN")}
                  {event.category ? ` · ${event.category}` : ""}
                  {event.operation ? ` · ${event.operation}` : ""}
                  {event.correlationId
                    ? ` · 关联 ${event.correlationId}`
                    : ""}
                </p>
                {event.metadata &&
                Object.keys(event.metadata).length > 0 ? (
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-neutral-500">
                    {Object.entries(event.metadata).map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="font-medium">{key}</dt>
                        <dd className="min-w-0 break-all font-mono">
                          {String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {event.technicalMessage ? (
                  <details className="mt-1 text-xs text-neutral-500">
                    <summary className="cursor-pointer">技术信息</summary>
                    <p className="mt-1 break-words font-mono">
                      {event.errorCode}: {event.technicalMessage}
                    </p>
                  </details>
                ) : null}
              </div>
            </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
