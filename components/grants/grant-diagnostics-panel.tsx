"use client";

import { useMemo, useState } from "react";
import type { GrantFindingDisposition, GrantFindingFeedback } from "@/lib/grants/feedback/contracts";
import { grantFindingTarget, indexGrantFindingFeedback, type GrantDiagnosticItem } from "./grant-diagnostic-view-model";

const scopeLabels = {
  cross_section: "跨章节",
  section: "章节",
  paragraph: "段落",
  sentence: "句子",
  term_or_citation: "术语或引用",
} as const;

const dispositionLabels: Record<GrantFindingDisposition, string> = {
  none: "未处理",
  prioritized: "优先处理",
  deferred: "稍后处理",
  ignored: "暂不处理",
  reported_false_positive: "报告误报",
};

type Props = {
  documentId: string;
  items: GrantDiagnosticItem[];
  feedback: GrantFindingFeedback[];
  selectedFindingId: string | null;
  loading: boolean;
  running: boolean;
  error: string;
  onRun: () => Promise<void>;
  onSelect: (item: GrantDiagnosticItem) => void;
  onFeedbackChange: (item: GrantFindingFeedback) => void;
};

export function GrantDiagnosticsPanel(props: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savingFindingId, setSavingFindingId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const feedbackByFinding = useMemo(() => indexGrantFindingFeedback(props.feedback), [props.feedback]);

  async function saveDisposition(findingId: string, disposition: GrantFindingDisposition) {
    setSavingFindingId(findingId);
    try {
      const response = await fetch(`/api/grants/documents/${props.documentId}/diagnostics/${findingId}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法保存处理状态。");
      props.onFeedbackChange(data as GrantFindingFeedback);
      setFeedbackError("");
    } catch (error) {
      setFeedbackError(error instanceof Error ? error.message : "无法保存处理状态。");
    } finally {
      setSavingFindingId(null);
    }
  }

  return (
    <aside aria-label="申请书问题" className="border-l border-slate-200 bg-white">
      <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="research-eyebrow">问题</p>
            <p className="mt-1 text-xs text-slate-500">建议默认收起，点击问题后查看。</p>
          </div>
          <button
            type="button"
            onClick={() => void props.onRun()}
            disabled={props.running}
            className="rounded-lg bg-[#155eef] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {props.running ? "检查中…" : "检查申请书"}
          </button>
        </div>

        {props.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{props.error}</p>}
        {feedbackError && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{feedbackError}</p>}
        {props.loading && <p className="mt-6 text-sm text-slate-500">正在读取问题…</p>}
        {!props.loading && props.items.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
            当前没有问题记录。点击“检查申请书”运行检查。
          </div>
        )}

        <div className="mt-4 space-y-3">
          {props.items.map((item) => {
            const finding = item.finding;
            const target = grantFindingTarget(item);
            const isExpanded = expanded.has(finding.findingId);
            const isSelected = props.selectedFindingId === finding.findingId;
            const disposition = feedbackByFinding.get(finding.findingId)?.disposition ?? "none";
            return (
              <article
                id={`grant-finding-${finding.findingId}`}
                key={finding.findingId}
                className={`rounded-2xl border bg-white transition ${isSelected ? "border-[#155eef] ring-2 ring-blue-100" : "border-slate-200"}`}
              >
                <button
                  type="button"
                  className="w-full px-4 py-4 text-left"
                  onClick={() => {
                    props.onSelect(item);
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(finding.findingId)) next.delete(finding.findingId); else next.add(finding.findingId);
                      return next;
                    });
                  }}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium leading-6 text-slate-900">{finding.message}</span>
                    <span aria-hidden className="mt-0.5 text-slate-400">{isExpanded ? "−" : "+"}</span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{scopeLabels[finding.assessment.scope]}</span>
                    <span>·</span>
                    <span>{target.navigable ? "可定位原文" : "需要人工定位"}</span>
                    {disposition !== "none" && <span className="rounded-full bg-slate-100 px-2 py-0.5">{dispositionLabels[disposition]}</span>}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                    <p className="text-xs font-semibold text-slate-700">修改建议</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{finding.recommendation}</p>
                    {finding.sourceAnchor.text && (
                      <blockquote className="mt-3 border-l-2 border-slate-200 pl-3 text-xs leading-5 text-slate-500">
                        {finding.sourceAnchor.text}
                      </blockquote>
                    )}
                    <label className="mt-4 block text-xs font-semibold text-slate-700" htmlFor={`feedback-${finding.findingId}`}>我的处理</label>
                    <select
                      id={`feedback-${finding.findingId}`}
                      value={disposition}
                      disabled={savingFindingId === finding.findingId}
                      onChange={(event) => void saveDisposition(finding.findingId, event.target.value as GrantFindingDisposition)}
                      className="research-focus mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      {Object.entries(dispositionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
