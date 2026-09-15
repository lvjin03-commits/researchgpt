"use client";

import { useEffect, useRef, useState } from "react";
import type { GrantAssistantCandidateContext, GrantAssistantDocumentSelectionContext } from "@/lib/grants/assistant/contracts";
import { GrantAssistantSourceControls } from "./grant-assistant-source-controls";
import { candidateContextFocus, documentSelectionFocuses, resolveGrantAssistantFocus, type GrantAssistantFocus } from "@/lib/grants/assistant/focus-state";

type ContextCoverage = { mode: "full_document" | "document_memory" | "retrieved_excerpts"; strategy: "single_pass" | "hierarchical" | "long_context" | "semantic_memory" | "semantic_targeted" | "retrieval";
  sourceRevisionId: string; sectionCount: number; coveredSectionCount: number; nodeCount: number; coveredNodeCount: number;
  complete: boolean; unitCount?: number };
type Message = { messageId: string; turnId?: string; role: "user" | "assistant"; content: string; localStatus?: "failed"; grounding?: "general_reasoning" | "evidence_grounded"; citations?: Array<{ citationId: string; sourceAlias?: string; label: string; url?: string }>; recommendedQuestions?: string[]; contextCoverage?: ContextCoverage };
type BillingPreview = { charging: "meter_only" | "canary" | "resumable"; canSubmit: boolean; maximumChargePoints: number; availablePoints: number | null; reason?: "insufficient_points" | "account_on_hold" | "daily_limit" };
type PausedBudget = { budgetId: string; turnId: string; version: number; requiredAdditionalPoints: number;
  settledPoints: number; authorizedPoints: number; question: string; canDeliverExisting: boolean;
  contextCoverage?: ContextCoverage };

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
  const [pendingAssistantTurnId, setPendingAssistantTurnId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [ambiguity, setAmbiguity] = useState<{ question: string; choices: GrantAssistantFocus[] } | null>(null);
  const [ignoreAmbiguousFocusOnce, setIgnoreAmbiguousFocusOnce] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [billing, setBilling] = useState<BillingPreview | null>(null);
  const [lastChargedPoints, setLastChargedPoints] = useState<number | null>(null);
  const [webBudgetPoints, setWebBudgetPoints] = useState("50");
  const [pausedBudget, setPausedBudget] = useState<PausedBudget | null>(null);
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const budgetActionInFlight = useRef(false);
  const budgetIncreaseAuthorization = useRef<{ budgetId: string; authorizationId: string } | null>(null);
  const conversationEnd = useRef<HTMLDivElement | null>(null);

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
        setWebBudgetPoints((current) => String(Math.max(Number(current) || 0, nextBilling.maximumChargePoints, 20)));
      }
      if (active) {
        const restoredBudget = data.pausedBudget ?? null;
        setPausedBudget(restoredBudget);
        setBudgetDialogOpen(Boolean(restoredBudget));
      }
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "无法恢复 Grant AI 对话。"));
    return () => { active = false; };
  }, [documentId]);

  useEffect(() => {
    conversationEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pendingAssistantTurnId]);

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
    setMessages((items) => [...items, { messageId: `${turnId}:user`, turnId, role: "user", content: question }]);
    setInput("");
    setPendingAssistantTurnId(turnId);
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
          ...(webSearch && billing?.charging === "resumable" ? { webBudgetPoints: Number(webBudgetPoints) } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(data.issues)
          ? data.issues.map((issue: { path?: unknown[]; message?: string }) => `${issue.path?.join(".") || "请求"}: ${issue.message ?? "格式错误"}`).join("；")
          : "";
        throw new Error(detail ? `${data.error ?? "请求失败"}（${detail}）` : (data.error ?? "Grant AI 对话失败。"));
      }
      setMessages((items) => [...items, { messageId: `${turnId}:assistant`, turnId, role: "assistant", content: data.content, grounding: data.grounding, citations: data.citations, recommendedQuestions: data.recommendedQuestions, contextCoverage: data.contextCoverage }]);
      const charge = data.webGrounding?.charging;
      if (data.webGrounding?.status === "awaiting_budget") {
        setPausedBudget({ budgetId: data.webGrounding.budgetId, turnId, version: data.webGrounding.version,
          requiredAdditionalPoints: data.webGrounding.requiredAdditionalPoints,
          settledPoints: data.webGrounding.settledPoints,
          authorizedPoints: data.webGrounding.authorizedPoints,
          question,
          canDeliverExisting: data.webGrounding.canDeliverExisting,
          contextCoverage: data.contextCoverage });
        setBudgetDialogOpen(true);
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
      setMessages((items) => items.map((message) => message.turnId === turnId && message.role === "user"
        ? { ...message, localStatus: "failed" }
        : message));
      setError(cause instanceof Error ? cause.message : "Grant AI 对话失败。");
    } finally {
      setPendingAssistantTurnId(null);
      setBusy(false);
    }
  }

  async function resolvePausedBudget(action: "increase" | "deliver-existing") {
    if (!pausedBudget || busy || budgetActionInFlight.current) return;
    budgetActionInFlight.current = true;
    setBusy(true); setError("");
    try {
      if (action === "increase" && budgetIncreaseAuthorization.current?.budgetId !== pausedBudget.budgetId) {
        budgetIncreaseAuthorization.current = { budgetId: pausedBudget.budgetId, authorizationId: crypto.randomUUID() };
      }
      const body = action === "increase" ? { budgetId: pausedBudget.budgetId,
        expectedVersion: pausedBudget.version, authorizationId: budgetIncreaseAuthorization.current!.authorizationId,
        additionalPoints: pausedBudget.requiredAdditionalPoints }
        : { budgetId: pausedBudget.budgetId, expectedVersion: pausedBudget.version };
      const response = await fetch(`/api/grants/documents/${documentId}/assistant/web-budget/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "insufficient_points" && typeof data.availablePoints === "number") {
          setBilling((current) => current ? { ...current, canSubmit: false,
            availablePoints: data.availablePoints, reason: "insufficient_points" } : current);
        }
        if (data.code === "grant_web_budget_stale") {
          const currentResponse = await fetch(`/api/grants/documents/${documentId}/assistant/chat`, { cache: "no-store" });
          const current = await currentResponse.json();
          if (currentResponse.ok) setPausedBudget(current.pausedBudget ?? null);
        }
        throw new Error(data.error ?? "联网预算操作失败。");
      }
      const continuation = data.continuation;
      if (continuation?.status === "awaiting_budget") {
        setPausedBudget({ budgetId: continuation.state.budgetId,
          turnId: continuation.checkpoint?.turnId ?? pausedBudget.turnId, version: continuation.state.version,
          requiredAdditionalPoints: continuation.requiredAdditionalPoints,
          settledPoints: continuation.state.settledPoints,
          authorizedPoints: continuation.state.authorizedPoints,
          question: continuation.checkpoint?.question ?? pausedBudget.question,
          canDeliverExisting: Boolean(continuation.checkpoint?.search?.sources?.length),
          contextCoverage: pausedBudget.contextCoverage });
        setBudgetDialogOpen(true);
      } else {
        setPausedBudget(null);
        setBudgetDialogOpen(false);
        budgetIncreaseAuthorization.current = null;
      }
      const delivered = continuation?.delivery?.answer;
      if (delivered) {
        setMessages((items) => [...items,
          ...(!items.some((message) => message.role === "user" && message.turnId === pausedBudget.turnId)
            ? [{ messageId: `${pausedBudget.budgetId}:user`, turnId: pausedBudget.turnId,
              role: "user" as const, content: pausedBudget.question }] : []),
          { messageId: crypto.randomUUID(), role: "assistant", content: delivered.content,
            grounding: delivered.grounding, citations: delivered.citations, recommendedQuestions: [],
            contextCoverage: pausedBudget.contextCoverage }]);
        if (typeof continuation.state?.settledPoints === "number") {
          setLastChargedPoints(continuation.state.settledPoints);
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "联网预算操作失败。"); }
    finally { budgetActionInFlight.current = false; setBusy(false); }
  }

  return <section aria-label="Grant AI 普通对话" className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
      {messages.length === 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">可以像普通 AI 对话一样讨论基金写作、研究思路和术语。系统先建立当前申请书的全文记忆，再按问题自动核对相关原文和当前 AI 诊断；点选正文后也可以限定讨论范围。对话不能修改正文。</div>}
      {messages.map((message) => message.role === "user"
        ? <div key={message.messageId} className="ml-8 rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-sm text-white">
            {message.content}
            {message.localStatus === "failed" && <div className="mt-2 flex items-center justify-end gap-2 border-t border-blue-400/60 pt-1.5 text-[11px] text-blue-100">
              <span>发送失败</span>
              <button type="button" onClick={() => { setMessages((items) => items.filter((item) => item.messageId !== message.messageId)); setInput((current) => current || message.content); }} className="font-semibold underline underline-offset-2 hover:text-white">重新编辑</button>
            </div>}
          </div>
        : <div key={message.messageId} className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 whitespace-pre-wrap">
            {message.content}
            {message.contextCoverage && <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${message.contextCoverage.complete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
              {message.contextCoverage.mode === "document_memory"
                ? `全文记忆已启用 · ${message.contextCoverage.coveredSectionCount}/${message.contextCoverage.sectionCount} 章 · 按需核对原文`
                : message.contextCoverage.strategy === "semantic_targeted"
                  ? `全文记忆 + 定向原文 · ${message.contextCoverage.coveredSectionCount}/${message.contextCoverage.sectionCount} 章 · ${message.contextCoverage.coveredNodeCount}/${message.contextCoverage.nodeCount} 节点`
                  : message.contextCoverage.complete
                    ? `全文原文已覆盖 · ${message.contextCoverage.coveredSectionCount}/${message.contextCoverage.sectionCount} 章 · ${message.contextCoverage.coveredNodeCount}/${message.contextCoverage.nodeCount} 节点${message.contextCoverage.unitCount ? ` · ${message.contextCoverage.unitCount} 个分析单元` : ""}`
                    : `相关片段 · ${message.contextCoverage.coveredSectionCount}/${message.contextCoverage.sectionCount} 章 · ${message.contextCoverage.coveredNodeCount}/${message.contextCoverage.nodeCount} 节点`}
            </div>}
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
      {pendingAssistantTurnId && <div aria-label="Grant AI 正在回复" className="w-fit rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
        <span className="sr-only">Grant AI 正在分析申请书</span>
        <span aria-hidden="true" className="flex items-center gap-1 py-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
        </span>
      </div>}
      <div ref={conversationEnd} />
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
      {webGroundingEnabled && <div className="mb-2 flex flex-wrap items-center gap-2"><button type="button" aria-pressed={webSearch} disabled={Boolean(pausedBudget)} onClick={() => setWebSearch((value) => !value)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${webSearch ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"}`}>{webSearch ? "联网补充：已开启" : "联网补充"}</button>{webSearch && billing?.charging === "canary" && <span className="text-[11px] text-slate-500">最多 {billing.maximumChargePoints} 智点 · 可用 {billing.availablePoints ?? 0}</span>}{webSearch && billing?.charging === "resumable" && <><label className="text-[11px] text-slate-600">本次智点上限 <input aria-label="联网智点上限" type="number" min={Math.max(20, billing.maximumChargePoints)} max={500} value={webBudgetPoints} disabled={Boolean(pausedBudget)} onChange={(event) => setWebBudgetPoints(event.target.value)} onBlur={() => setWebBudgetPoints(String(Math.max(20, billing.maximumChargePoints, Math.min(500, Number(webBudgetPoints) || 20))))} className="ml-1 w-16 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-100" /></label><span className="text-[11px] text-slate-500">可设置 {Math.max(20, billing.maximumChargePoints)}–500 · 账户可用 {billing.availablePoints ?? 0} · 仅按实际消耗扣除</span></>}</div>}
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-blue-500">
        <textarea aria-label="向 Grant AI 提问" value={input} onChange={(event) => { const next = event.target.value; setInput(next); setError(""); if (ambiguity && next.trim() !== ambiguity.question) { setAmbiguity(null); setIgnoreAmbiguousFocusOnce(true); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !busy) { event.preventDefault(); void send(); } }} placeholder="询问基金写作、研究思路或术语" className="min-h-16 flex-1 resize-none border-0 px-2 py-1 text-sm outline-none" />
        <button type="button" disabled={!input.trim() || busy || !canGenerate || Boolean(pausedBudget) || Boolean(webSearch && billing && !billing.canSubmit) || Boolean(webSearch && billing?.charging === "resumable" && (!Number.isInteger(Number(webBudgetPoints)) || Number(webBudgetPoints) < Math.max(20, billing.maximumChargePoints) || Number(webBudgetPoints) > 500))} onClick={() => void send()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">发送</button>
      </div>
      {webSearch && billing && !billing.canSubmit && <p className="mt-2 text-xs text-amber-700">{billing.reason === "insufficient_points" ? `账户智点不足：下一阶段需要预留 ${billing.maximumChargePoints}，当前可用 ${billing.availablePoints ?? 0}。增加预算上限不会增加账户余额。` : billing.reason === "account_on_hold" ? "智点账户暂时不可用。" : "今日联网问答额度已用完。"}</p>}
      {lastChargedPoints !== null && <p className="mt-2 text-[11px] text-emerald-700">本次联网问答实际消耗 {lastChargedPoints} 智点。</p>}
      {pausedBudget && <p className="mt-2 text-xs text-amber-700">请先处理上一次联网研究的智点确认，再提交新问题。{!budgetDialogOpen && <button type="button" onClick={() => setBudgetDialogOpen(true)} className="ml-1 font-semibold underline underline-offset-2">查看</button>}</p>}
      {!canGenerate && <p className="mt-2 text-xs text-amber-700">请先保存当前正文，再开始普通对话。</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-[11px] leading-4 text-slate-400">对话已安全保存，可在刷新页面后继续。</p>
    </div>
    {pausedBudget && budgetDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="grant-web-budget-dialog-title" className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <button type="button" aria-label="关闭智点提醒" disabled={busy} onClick={() => setBudgetDialogOpen(false)} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40">×</button>
        <h2 id="grant-web-budget-dialog-title" className="pr-9 text-base font-semibold text-slate-950">是否继续完善联网结果？</h2>
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">正在处理：{pausedBudget.question}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">当前已使用 {pausedBudget.settledPoints} / {pausedBudget.authorizedPoints} 智点。系统按剩余全部阶段估算，建议一次追加最多 <strong className="text-slate-950">{pausedBudget.requiredAdditionalPoints} 智点</strong>。</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">确认后立即继续检索和分析；若后续仍不足，可以再次追加。仅按实际消耗扣费，未使用部分不会扣除。{pausedBudget.canDeliverExisting ? "也可以不追加，基于已经保存的搜索结果生成当前可交付答案。" : "目前尚未取得可整理的搜索结果，因此需要追加预算才能继续。"}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{pausedBudget.canDeliverExisting && <button type="button" disabled={busy} onClick={() => void resolvePausedBudget("deliver-existing")} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">不追加，整理现有结果</button>}<button type="button" disabled={busy} onClick={() => void resolvePausedBudget("increase")} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "处理中…" : `追加 ${pausedBudget.requiredAdditionalPoints} 智点并继续`}</button></div>
      </section>
    </div>}
  </section>;
}
