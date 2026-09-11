"use client";

import { useEffect, useState } from "react";
import type { GrantAssistantCandidateContext, GrantAssistantDocumentSelectionContext } from "@/lib/grants/assistant/contracts";
import { GrantAssistantSourceControls } from "./grant-assistant-source-controls";
import { candidateContextFocus, documentSelectionFocuses, resolveGrantAssistantFocus, type GrantAssistantFocus } from "@/lib/grants/assistant/focus-state";

type Message = { messageId: string; turnId?: string; role: "user" | "assistant"; content: string; grounding?: "general_reasoning" | "evidence_grounded"; citations?: Array<{ citationId: string; sourceAlias?: string; label: string; url?: string }>; recommendedQuestions?: string[] };
type BillingPreview = { charging: "meter_only" | "canary" | "resumable"; canSubmit: boolean; maximumChargePoints: number; availablePoints: number | null; reason?: "insufficient_points" | "account_on_hold" | "daily_limit" };
type PausedBudget = { budgetId: string; turnId: string; version: number; requiredAdditionalPoints: number;
  settledPoints: number; authorizedPoints: number; question: string; canDeliverExisting: boolean };

export function GrantAssistantChatPanel({ documentId, currentRevisionId, canGenerate, contextCards, candidateContext, initialPrompt, onCandidateContextClear, evidenceEnabled, webGroundingEnabled }: {
  documentId: string;
  currentRevisionId: string;
  canGenerate: boolean;
  contextCards: GrantAssistantDocumentSelectionContext[];
  candidateContext: GrantAssistantCandidateContext | null;
  initialPrompt?: string;
  onCandidateContextClear: () => void;
  evidenceEnabled: boolean;
  webGroundingEnabled: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [ambiguity, setAmbiguity] = useState<{ question: string; choices: GrantAssistantFocus[] } | null>(null);
  const [ignoreAmbiguousFocusOnce, setIgnoreAmbiguousFocusOnce] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [billing, setBilling] = useState<BillingPreview | null>(null);
  const [lastChargedPoints, setLastChargedPoints] = useState<number | null>(null);
  const [webBudgetPoints, setWebBudgetPoints] = useState(50);
  const [pausedBudget, setPausedBudget] = useState<PausedBudget | null>(null);

  useEffect(() => {
    // The selected-document action supplies a new one-shot prompt to this mounted panel.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialPrompt) setInput(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/grants/documents/${documentId}/assistant/chat`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法恢复 Grant AI 对话。");
      if (active) setMessages((data.messages ?? []).map((message: Message) => message));
      const nextBilling = data.billing ?? null;
      if (active) setBilling(nextBilling);
      if (active && nextBilling?.charging === "resumable") {
        setWebBudgetPoints((current) => Math.max(current, nextBilling.maximumChargePoints, 20));
      }
      if (active) setPausedBudget(data.pausedBudget ?? null);
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "无法恢复 Grant AI 对话。"));
    return () => { active = false; };
  }, [documentId]);

  async function send(explicitFocusId?: string) {
    const question = input.trim();
    if (!question || busy || !canGenerate || pausedBudget) return;
    const currentContextCards = contextCards.filter((card) => card.sourceRevisionId === currentRevisionId);
    const focusResolution = resolveGrantAssistantFocus({
      message: question,
      available: [...documentSelectionFocuses(currentContextCards), ...(candidateContext ? [candidateContextFocus(candidateContext)] : [])],
      explicitFocusId: explicitFocusId ?? candidateContext?.candidateId,
      ignoreAmbiguousFocus: ignoreAmbiguousFocusOnce,
    });
    if (focusResolution.kind === "ambiguous") {
      setAmbiguity({ question, choices: focusResolution.choices });
      return;
    }
    const turnId = crypto.randomUUID();
    const submittedContextCards = focusResolution.kind === "resolved"
      ? currentContextCards.filter((card) => card.contextCardId === focusResolution.focus.focusId)
      : [];
    const submittedFocusId = focusResolution.kind === "resolved" ? focusResolution.focus.focusId : null;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/grants/documents/${documentId}/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevisionId: currentRevisionId,
          turnId,
          message: question,
          contextCards: submittedContextCards,
          evidenceSourceIds: selectedSourceIds,
          focusId: submittedFocusId,
          ignoreAmbiguousFocus: ignoreAmbiguousFocusOnce,
          candidateContext,
          webSearch,
          ...(webSearch && billing?.charging === "resumable" ? { webBudgetPoints } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(data.issues)
          ? data.issues.map((issue: { path?: unknown[]; message?: string }) => `${issue.path?.join(".") || "请求"}: ${issue.message ?? "格式错误"}`).join("；")
          : "";
        throw new Error(detail ? `${data.error ?? "请求失败"}（${detail}）` : (data.error ?? "Grant AI 对话失败。"));
      }
      setMessages((items) => [...items, { messageId: `${turnId}:user`, turnId, role: "user", content: question }, { messageId: `${turnId}:assistant`, turnId, role: "assistant", content: data.content, grounding: data.grounding, citations: data.citations, recommendedQuestions: data.recommendedQuestions }]);
      setInput("");
      const charge = data.webGrounding?.charging;
      if (data.webGrounding?.status === "awaiting_budget") {
        setPausedBudget({ budgetId: data.webGrounding.budgetId, turnId, version: data.webGrounding.version,
          requiredAdditionalPoints: data.webGrounding.requiredAdditionalPoints,
          settledPoints: data.webGrounding.settledPoints,
          authorizedPoints: data.webGrounding.authorizedPoints,
          question,
          canDeliverExisting: data.webGrounding.canDeliverExisting });
      }
      if (charge?.mode === "charged") {
        setLastChargedPoints(charge.chargedPoints);
        setBilling((current) => current?.availablePoints == null ? current : {
          ...current, availablePoints: Math.max(0, current.availablePoints - charge.chargedPoints),
          canSubmit: current.availablePoints - charge.chargedPoints >= current.maximumChargePoints,
        });
      }
      setAmbiguity(null);
      setIgnoreAmbiguousFocusOnce(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Grant AI 对话失败。");
    } finally {
      setBusy(false);
    }
  }

  async function resolvePausedBudget(action: "increase" | "deliver-existing") {
    if (!pausedBudget || busy) return;
    setBusy(true); setError("");
    try {
      const body = action === "increase" ? { budgetId: pausedBudget.budgetId,
        expectedVersion: pausedBudget.version, authorizationId: crypto.randomUUID(),
        additionalPoints: pausedBudget.requiredAdditionalPoints }
        : { budgetId: pausedBudget.budgetId, expectedVersion: pausedBudget.version };
      const response = await fetch(`/api/grants/documents/${documentId}/assistant/web-budget/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "联网预算操作失败。");
      const continuation = data.continuation;
      if (continuation?.status === "awaiting_budget") {
        setPausedBudget({ budgetId: continuation.state.budgetId,
          turnId: continuation.checkpoint?.turnId ?? pausedBudget.turnId, version: continuation.state.version,
          requiredAdditionalPoints: continuation.requiredAdditionalPoints,
          settledPoints: continuation.state.settledPoints,
          authorizedPoints: continuation.state.authorizedPoints,
          question: continuation.checkpoint?.question ?? pausedBudget.question,
          canDeliverExisting: Boolean(continuation.checkpoint?.search?.sources?.length) });
      } else {
        setPausedBudget(null);
      }
      const delivered = continuation?.delivery?.answer;
      if (delivered) {
        setMessages((items) => [...items,
          ...(!items.some((message) => message.role === "user" && message.turnId === pausedBudget.turnId)
            ? [{ messageId: `${pausedBudget.budgetId}:user`, turnId: pausedBudget.turnId,
              role: "user" as const, content: pausedBudget.question }] : []),
          { messageId: crypto.randomUUID(), role: "assistant", content: delivered.content,
            grounding: delivered.grounding, citations: delivered.citations, recommendedQuestions: [] }]);
        if (typeof continuation.state?.settledPoints === "number") {
          setLastChargedPoints(continuation.state.settledPoints);
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "联网预算操作失败。"); }
    finally { setBusy(false); }
  }

  return <section aria-label="Grant AI 普通对话" className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
      {messages.length === 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">可以讨论基金写作、研究思路和术语。提问时会自动查找申请书相关原文；点选正文后也可以限定讨论范围。对话不能修改正文。</div>}
      {messages.map((message) => message.role === "user"
        ? <div key={message.messageId} className="ml-8 rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-sm text-white">{message.content}</div>
        : <div key={message.messageId} className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 whitespace-pre-wrap">
            {message.content}
            {message.grounding === "evidence_grounded" && <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] leading-5 text-slate-500">
              <div className="mb-1 font-semibold text-slate-600">参考来源</div>
              <ol className="space-y-1 pl-4">
                {message.citations?.filter((citation, index, all) => all.findIndex((item) => item.label === citation.label && item.url === citation.url) === index).map((citation) => <li key={`${citation.citationId}:${citation.url ?? citation.label}`} className="list-decimal pl-1">{citation.url ? <a href={citation.url} target="_blank" rel="noopener noreferrer" className="break-words text-blue-600 underline decoration-blue-300 underline-offset-2 hover:text-blue-800">{citation.sourceAlias ? `[${citation.sourceAlias}] ` : ""}{citation.label}</a> : citation.label}</li>)}
              </ol>
            </div>}
            {message.recommendedQuestions && message.recommendedQuestions.length > 0 && <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {message.recommendedQuestions.map((question) => <button key={question} type="button" onClick={() => setInput(question)} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-left text-xs leading-5 text-blue-700 hover:border-blue-400">{question}</button>)}
            </div>}
          </div>)}
    </div>
    <div className="shrink-0 border-t border-slate-200 pt-3">
      {candidateContext && <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
        <span className="min-w-0 truncate text-blue-900">正在讨论候选稿 · {candidateContext.targetLabel}</span>
        <button type="button" onClick={onCandidateContextClear} className="shrink-0 rounded px-1.5 py-0.5 text-blue-600 hover:bg-white">移除</button>
      </div>}
      {ambiguity && <section aria-label="请选择讨论对象" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-semibold text-amber-900">你说的内容是指哪一处？</p>
        <div className="mt-2 space-y-2">
          {ambiguity.choices.map((choice) => {
            const card = contextCards.find((item) => item.contextCardId === choice.focusId);
            return <button key={choice.focusId} type="button" onClick={() => void send(choice.focusId)} className="block w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-xs text-slate-700 hover:border-blue-300">
              <span className="font-semibold text-slate-900">{choice.targetLabel}</span>
              {card && <span className="mt-1 block line-clamp-2 text-slate-500">“{card.text}”</span>}
            </button>;
          })}
        </div>
      </section>}
      <GrantAssistantSourceControls documentId={documentId} enabled={evidenceEnabled} selectedSourceIds={selectedSourceIds} onSelectionChange={setSelectedSourceIds} onError={setError} />
      {webGroundingEnabled && <div className="mb-2 flex flex-wrap items-center gap-2"><button type="button" aria-pressed={webSearch} disabled={Boolean(pausedBudget)} onClick={() => setWebSearch((value) => !value)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${webSearch ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"}`}>{webSearch ? "联网补充：已开启" : "联网补充"}</button>{webSearch && billing?.charging === "canary" && <span className="text-[11px] text-slate-500">最多 {billing.maximumChargePoints} 智点 · 可用 {billing.availablePoints ?? 0}</span>}{webSearch && billing?.charging === "resumable" && <><label className="text-[11px] text-slate-600">本次智点上限 <input aria-label="联网智点上限" type="number" min={Math.max(20, billing.maximumChargePoints)} max={500} value={webBudgetPoints} disabled={Boolean(pausedBudget)} onChange={(event) => setWebBudgetPoints(Math.max(20, billing.maximumChargePoints, Math.min(500, Number(event.target.value) || 20)))} className="ml-1 w-16 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100" /></label><span className="text-[11px] text-slate-500">仅按实际消耗扣除，未使用部分不会扣费</span></>}</div>}
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-blue-500">
        <textarea aria-label="向 Grant AI 提问" value={input} onChange={(event) => { const next = event.target.value; setInput(next); setError(""); if (ambiguity && next.trim() !== ambiguity.question) { setAmbiguity(null); setIgnoreAmbiguousFocusOnce(true); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="询问基金写作、研究思路或术语" className="min-h-16 flex-1 resize-none border-0 px-2 py-1 text-sm outline-none" />
        <button type="button" disabled={!input.trim() || busy || !canGenerate || Boolean(pausedBudget) || Boolean(webSearch && billing?.charging === "canary" && !billing.canSubmit)} onClick={() => void send()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy ? "处理中…" : "发送"}</button>
      </div>
      {webSearch && billing?.charging === "canary" && !billing.canSubmit && <p className="mt-2 text-xs text-amber-700">{billing.reason === "insufficient_points" ? `智点不足：需要预留 ${billing.maximumChargePoints}，当前可用 ${billing.availablePoints ?? 0}。` : billing.reason === "account_on_hold" ? "智点账户暂时不可用。" : "今日联网问答额度已用完。"}</p>}
      {lastChargedPoints !== null && <p className="mt-2 text-[11px] text-emerald-700">本次联网问答实际消耗 {lastChargedPoints} 智点。</p>}
      {pausedBudget && <p className="mt-2 text-xs text-amber-700">请先处理上一次联网研究的智点确认，再提交新问题。</p>}
      {!canGenerate && <p className="mt-2 text-xs text-amber-700">请先保存当前正文，再开始普通对话。</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-[11px] leading-4 text-slate-400">对话已安全保存，可在刷新页面后继续。</p>
    </div>
    {pausedBudget && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-label="是否增加联网智点" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-slate-950">是否继续完善联网结果？</h2>
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">正在处理：{pausedBudget.question}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">当前已使用 {pausedBudget.settledPoints} / {pausedBudget.authorizedPoints} 智点。完成下一阶段还需授权最多 <strong className="text-slate-950">{pausedBudget.requiredAdditionalPoints} 智点</strong>。</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">追加后继续检索和分析，仍只按实际消耗扣费。{pausedBudget.canDeliverExisting ? "也可以不追加，基于已经保存的搜索结果生成当前可交付答案。" : "目前尚未取得可整理的搜索结果，因此需要追加预算才能继续。"}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{pausedBudget.canDeliverExisting && <button type="button" disabled={busy} onClick={() => void resolvePausedBudget("deliver-existing")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">不追加，整理现有结果</button>}<button type="button" disabled={busy} onClick={() => void resolvePausedBudget("increase")} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "处理中…" : `追加 ${pausedBudget.requiredAdditionalPoints} 智点并继续`}</button></div>
      </section>
    </div>}
  </section>;
}
