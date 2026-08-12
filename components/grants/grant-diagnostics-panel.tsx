"use client";

import { useMemo, useState } from "react";
import type { GrantFindingDisposition, GrantFindingFeedback } from "@/lib/grants/feedback/contracts";
import { grantFindingTarget, indexGrantFindingFeedback, type GrantDiagnosticItem } from "./grant-diagnostic-view-model";
import { GrantAiPatchPanel } from "./grant-ai-patch-panel";
import type { GrantDiagnosticCoverage, GrantRecheckSummary } from "@/lib/grants/application/diagnostic-service";
import { GrantFigureAuthorizationControl } from "./grant-figure-authorization-control";

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

const relatedLocationLabels = {
  supporting_location: "支撑位置",
  conflicting_location: "冲突位置",
  upstream_dependency: "上游依据",
  downstream_dependency: "下游对应",
  comparison_location: "对照位置",
  missing_expected_location: "预期缺失位置",
} as const;

type Props = {
  documentId: string;
  currentRevisionId: string;
  aiPatchEnabled: boolean;
  evidencePatchEnabled: boolean;
  canGeneratePatch: boolean;
  items: GrantDiagnosticItem[];
  feedback: GrantFindingFeedback[];
  selectedFindingId: string | null;
  loading: boolean;
  running: boolean;
  error: string;
  recheckEnabled: boolean;
  recheck: GrantRecheckSummary;
  coverage: GrantDiagnosticCoverage;
  onRun: () => Promise<void>;
  onSelect: (item: GrantDiagnosticItem) => void;
  onNavigateNode: (nodeId: string, findingId: string) => void;
  onFeedbackChange: (item: GrantFindingFeedback) => void;
  onPatchAccepted: () => Promise<void>;
};

function semanticFailureMessage(coverage: GrantDiagnosticCoverage): string {
  switch (coverage.semanticFailure?.category) {
    case "structured_reference_invalid": return "GPT 返回的位置或证据标识不符合程序合同。系统已记录具体校验规则，并停止盲目重试；程序检查结果仍然保留。";
    case "output_truncated": return "GPT 输出达到长度上限，语义诊断在完成前被截断。系统已按统一预算受控重试，当前没有把不完整结果写成诊断。";
    case "content_filtered": return "GPT 的内容过滤器中止了本次语义诊断，程序检查结果仍然保留。";
    case "provider_refusal": return "GPT 拒绝了本次语义诊断请求，程序检查结果仍然保留。";
    case "structured_output_invalid": return "GPT 返回的诊断结构不符合当前合同。系统已尝试一次受控修正，但没有把无效结果写入。";
    case "semantic_reference_invalid": return "GPT 返回了不属于本次申请书输入范围的章节或段落引用，系统已阻止越界结果写入。";
    case "provider_rate_limited": return "GPT 服务当前限流，本次语义诊断未完成；程序检查结果仍然保留。";
    case "provider_transient_error": return "GPT 服务发生临时故障，受控重试后仍未完成语义诊断。";
    case "provider_contract_error": return "GPT 请求参数或服务合同不兼容，本次语义诊断未发送为有效结果。";
    case "provider_unavailable": return "GPT 服务当前不可用，本次语义诊断未完成。";
    default: return "程序检查已保留，但 GPT 语义诊断未完成。系统没有把程序检查结果冒充完整 AI 诊断。";
  }
}

function imageCoverageMessage(coverage: GrantDiagnosticCoverage): string | null {
  const images = coverage.images;
  if (!images || images.candidateCount === 0) return null;
  if (images.mode === "multimodal") {
    return `本次 AI 已读取 ${images.suppliedCount}/${images.candidateCount} 张授权图片${images.omittedCount > 0 ? "；其余图片因格式、大小或数量限制未送入模型" : ""}。`;
  }
  const reason = images.reasons.includes("not_authorized")
    ? "尚未授权图片用于 AI 诊断"
    : images.reasons.includes("authorization_changed")
      ? "诊断期间图片授权或正文版本发生变化"
      : images.reasons.includes("unsupported_media_type")
        ? "图片格式不受当前模型输入支持"
        : images.reasons.includes("image_too_large") || images.reasons.includes("image_capacity_limit")
          ? "图片超过当前诊断容量限制"
          : "图片资产暂时无法读取";
  return `本次仅完成文本诊断，AI 未读取图片：${reason}。图片相关判断可能不完整。`;
}

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
    <aside aria-label="申请书问题" className="border-l border-slate-200 bg-white xl:h-full xl:min-h-0 xl:overflow-hidden">
      <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto p-4 xl:static xl:h-full xl:max-h-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="research-eyebrow">问题</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">建议默认收起，点击问题后查看。</p>
          </div>
          <button
            type="button"
            onClick={() => void props.onRun()}
            disabled={props.running}
            className="whitespace-nowrap rounded-lg bg-[#155eef] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {props.running ? "AI诊断中…" : props.recheckEnabled && props.recheck.state !== "not_run" ? "AI复检" : "AI诊断"}
          </button>
        </div>

        <GrantFigureAuthorizationControl
          documentId={props.documentId}
          currentRevisionId={props.currentRevisionId}
        />

        {props.coverage.semantic === "failed" && (
          <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
            {semanticFailureMessage(props.coverage)}
          </p>
        )}

        {props.coverage.semantic === "complete" && (
          <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-800">
            已完成程序规则检查和 GPT 语义诊断{props.coverage.semanticModelId ? `（${props.coverage.semanticModelId}）` : ""}。
          </p>
        )}

        {imageCoverageMessage(props.coverage) && (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
            {imageCoverageMessage(props.coverage)}
          </p>
        )}

        {props.recheckEnabled && props.recheck.state !== "not_run" && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
            {props.recheck.inputMode === "section_bundle"
              ? `已增量检查 ${props.recheck.checkedSectionCount} 个受影响章节。`
              : "已执行全文检查。"}
            {props.recheck.state === "resolved" && " 当前检查未发现遗留问题。"}
            {props.recheck.state === "stable" && " 问题集合与上次相同，建议调整修改方案后再复检。"}
            {props.recheck.state === "improving" && ` 已解决 ${props.recheck.resolvedCount} 项。`}
            {props.recheck.state === "regressed" && ` 新出现 ${props.recheck.introducedCount} 项，请先检查本轮修改。`}
            {props.recheck.reusedExecution && " 当前版本未变化，已复用已有结果。"}
          </p>
        )}

        {props.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">{props.error}</p>}
        {feedbackError && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">{feedbackError}</p>}
        {props.loading && <p className="mt-6 text-sm text-slate-500">正在读取问题…</p>}
        {!props.loading && props.items.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
            当前没有问题记录。点击“AI诊断”运行程序检查和 GPT 语义诊断。
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
                    <span className="text-sm font-medium leading-6 text-slate-900">{finding.title ?? finding.diagnosticFact}</span>
                    <span aria-hidden className="mt-0.5 text-slate-400">{isExpanded ? "−" : "+"}</span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                    <span>{scopeLabels[finding.assessment.scope]}</span>
                    <span>·</span>
                    <span>{target.navigable ? "可定位原文" : "需要人工定位"}</span>
                    {item.reviewState === "needs_recheck" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">需复检</span>
                    )}
                    {item.reviewState === "stale" && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">锚点已失效</span>
                    )}
                    {disposition !== "none" && <span className="rounded-full bg-slate-100 px-2 py-0.5">{dispositionLabels[disposition]}</span>}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                    {finding.title && finding.title !== finding.diagnosticFact && (
                      <div className="mb-3">
                        <p className="text-sm font-semibold text-slate-700">诊断事实</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{finding.diagnosticFact}</p>
                      </div>
                    )}
                    {finding.reason && (
                      <div className="mb-3">
                        <p className="text-sm font-semibold text-slate-700">判断依据</p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">{finding.reason}</p>
                      </div>
                    )}
                    <p className="text-sm font-semibold text-slate-700">修改建议</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{finding.recommendation}</p>
                    {finding.possibleConsequence && (
                      <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2">
                        <p className="text-sm font-semibold text-amber-900">评审可能追问</p>
                        <p className="mt-1 text-sm leading-6 text-amber-900">{finding.possibleConsequence}</p>
                      </div>
                    )}
                    {finding.rootOccurrences.length > 1 && (
                      <div className="mt-3">
                        <p className="text-sm font-semibold text-slate-700">同一根因的原文表现（{finding.rootOccurrences.length}处）</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {finding.rootOccurrences.map((occurrence, index) => (
                            <button
                              type="button"
                              key={occurrence.occurrenceFingerprint}
                              onClick={() => props.onNavigateNode(occurrence.primaryLocation.nodeId, finding.findingId)}
                              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800"
                            >
                              定位表现 {index + 1}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {finding.sourceAnchor.text && (
                      <blockquote className="mt-3 border-l-2 border-slate-200 pl-3 text-sm leading-6 text-slate-500">
                        {finding.sourceAnchor.text}
                      </blockquote>
                    )}
                    {finding.relatedLocations.length > 0 && (
                      <div className="mt-3">
                        <p className="text-sm font-semibold text-slate-700">关联位置</p>
                        <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-500">
                          {finding.relatedLocations.map((location) => (
                            <li key={`${location.sectionId}:${location.nodeId}:${location.role}`} className="rounded-lg bg-slate-50 px-3 py-2">
                              <span className="font-medium text-slate-600">{relatedLocationLabels[location.role]}</span>
                              {location.quote ? `：${location.quote}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor={`feedback-${finding.findingId}`}>我的处理</label>
                    <select
                      id={`feedback-${finding.findingId}`}
                      value={disposition}
                      disabled={savingFindingId === finding.findingId}
                      onChange={(event) => void saveDisposition(finding.findingId, event.target.value as GrantFindingDisposition)}
                      className="research-focus mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      {Object.entries(dispositionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <GrantAiPatchPanel
                      documentId={props.documentId}
                      currentRevisionId={props.currentRevisionId}
                      findingId={finding.findingId}
                      targetNodeId={target.nodeId}
                      enabled={props.aiPatchEnabled}
                      evidencePatchEnabled={props.evidencePatchEnabled}
                      canGenerate={props.canGeneratePatch}
                      onAccepted={props.onPatchAccepted}
                    />
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
