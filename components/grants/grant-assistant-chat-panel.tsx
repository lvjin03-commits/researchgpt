"use client";

import { useEffect, useState } from "react";
import type { GrantAssistantCandidateContext, GrantAssistantDocumentSelectionContext } from "@/lib/grants/assistant/contracts";
import { GrantAssistantSourceControls } from "./grant-assistant-source-controls";
import { candidateContextFocus, documentSelectionFocuses, resolveGrantAssistantFocus, type GrantAssistantFocus } from "@/lib/grants/assistant/focus-state";

type Message = { messageId: string; role: "user" | "assistant"; content: string; grounding?: "general_reasoning" | "evidence_grounded"; citations?: Array<{ citationId: string; label: string }>; recommendedQuestions?: string[] };

export function GrantAssistantChatPanel({ documentId, currentRevisionId, canGenerate, contextCards, candidateContext, initialPrompt, onCandidateContextClear, evidenceEnabled }: {
  documentId: string;
  currentRevisionId: string;
  canGenerate: boolean;
  contextCards: GrantAssistantDocumentSelectionContext[];
  candidateContext: GrantAssistantCandidateContext | null;
  initialPrompt?: string;
  onCandidateContextClear: () => void;
  evidenceEnabled: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [ambiguity, setAmbiguity] = useState<{ question: string; choices: GrantAssistantFocus[] } | null>(null);
  const [ignoreAmbiguousFocusOnce, setIgnoreAmbiguousFocusOnce] = useState(false);

  useEffect(() => {
    if (initialPrompt) setInput(initialPrompt);
  }, [initialPrompt]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/grants/documents/${documentId}/assistant/chat`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法恢复 Grant AI 对话。");
      if (active) setMessages((data.messages ?? []).map((message: Message) => message));
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "无法恢复 Grant AI 对话。"));
    return () => { active = false; };
  }, [documentId]);

  async function send(explicitFocusId?: string) {
    const question = input.trim();
    if (!question || busy || !canGenerate) return;
    const focusResolution = resolveGrantAssistantFocus({
      message: question,
      available: [...documentSelectionFocuses(contextCards), ...(candidateContext ? [candidateContextFocus(candidateContext)] : [])],
      explicitFocusId: explicitFocusId ?? candidateContext?.candidateId,
      ignoreAmbiguousFocus: ignoreAmbiguousFocusOnce,
    });
    if (focusResolution.kind === "ambiguous") {
      setAmbiguity({ question, choices: focusResolution.choices });
      return;
    }
    const turnId = crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/grants/documents/${documentId}/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevisionId: currentRevisionId,
          turnId,
          message: question,
          contextCards,
          evidenceSourceIds: selectedSourceIds,
          focusId: explicitFocusId ?? candidateContext?.candidateId ?? null,
          ignoreAmbiguousFocus: ignoreAmbiguousFocusOnce,
          candidateContext,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Grant AI 对话失败。");
      setMessages((items) => [...items, { messageId: `${turnId}:user`, role: "user", content: question }, { messageId: `${turnId}:assistant`, role: "assistant", content: data.content, grounding: data.grounding, citations: data.citations, recommendedQuestions: data.recommendedQuestions }]);
      setInput("");
      setAmbiguity(null);
      setIgnoreAmbiguousFocusOnce(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Grant AI 对话失败。");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="Grant AI 普通对话" className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2">
      {messages.length === 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">可以讨论基金写作、研究思路和术语。上方引用的正文会作为本轮依据；没有引用时按普通讨论回答。对话不能修改正文。</div>}
      {messages.map((message) => message.role === "user"
        ? <div key={message.messageId} className="ml-8 rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-sm text-white">{message.content}</div>
        : <div key={message.messageId} className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 whitespace-pre-wrap">
            {message.content}
            {message.grounding === "evidence_grounded" && <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-4 text-slate-500">依据：{message.citations?.map((citation) => citation.label).filter((label, index, all) => all.indexOf(label) === index).join("、")}</div>}
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
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-blue-500">
        <textarea aria-label="向 Grant AI 提问" value={input} onChange={(event) => { const next = event.target.value; setInput(next); if (ambiguity && next.trim() !== ambiguity.question) { setAmbiguity(null); setIgnoreAmbiguousFocusOnce(true); } }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="询问基金写作、研究思路或术语" className="min-h-16 flex-1 resize-none border-0 px-2 py-1 text-sm outline-none" />
        <button type="button" disabled={!input.trim() || busy || !canGenerate} onClick={() => void send()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy ? "处理中…" : "发送"}</button>
      </div>
      {!canGenerate && <p className="mt-2 text-xs text-amber-700">请先保存当前正文，再开始普通对话。</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-[11px] leading-4 text-slate-400">对话已安全保存，可在刷新页面后继续。</p>
    </div>
  </section>;
}
