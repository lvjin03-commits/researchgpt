"use client";

import { useEffect, useState } from "react";
import type { GrantAssistantDocumentSelectionContext } from "@/lib/grants/assistant/contracts";
import { GrantAssistantSourceControls } from "./grant-assistant-source-controls";

type Message = { messageId: string; role: "user" | "assistant"; content: string; grounding?: "general_reasoning" | "evidence_grounded"; citations?: Array<{ citationId: string; label: string }> };

export function GrantAssistantChatPanel({ documentId, currentRevisionId, canGenerate, contextCards, evidenceEnabled }: {
  documentId: string;
  currentRevisionId: string;
  canGenerate: boolean;
  contextCards: GrantAssistantDocumentSelectionContext[];
  evidenceEnabled: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/grants/documents/${documentId}/assistant/chat`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法恢复 Grant AI 对话。");
      if (active) setMessages((data.messages ?? []).map((message: Message) => message));
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "无法恢复 Grant AI 对话。"));
    return () => { active = false; };
  }, [documentId]);

  async function send() {
    const question = input.trim();
    if (!question || busy || !canGenerate) return;
    const turnId = crypto.randomUUID();
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/grants/documents/${documentId}/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevisionId: currentRevisionId, turnId, message: question, contextCards, evidenceSourceIds: selectedSourceIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Grant AI 对话失败。");
      setMessages((items) => [...items, { messageId: `${turnId}:user`, role: "user", content: question }, { messageId: `${turnId}:assistant`, role: "assistant", content: data.content, grounding: data.grounding, citations: data.citations }]);
      setInput("");
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
        : <div key={message.messageId} className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-800 whitespace-pre-wrap">{message.content}{message.grounding === "evidence_grounded" && <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-4 text-slate-500">依据：{message.citations?.map((citation) => citation.label).filter((label, index, all) => all.indexOf(label) === index).join("、")}</div>}</div>)}
    </div>
    <div className="shrink-0 border-t border-slate-200 pt-3">
      <GrantAssistantSourceControls documentId={documentId} enabled={evidenceEnabled} selectedSourceIds={selectedSourceIds} onSelectionChange={setSelectedSourceIds} onError={setError} />
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-blue-500">
        <textarea aria-label="向 Grant AI 提问" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="询问基金写作、研究思路或术语" className="min-h-16 flex-1 resize-none border-0 px-2 py-1 text-sm outline-none" />
        <button type="button" disabled={!input.trim() || busy || !canGenerate} onClick={() => void send()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy ? "处理中…" : "发送"}</button>
      </div>
      {!canGenerate && <p className="mt-2 text-xs text-amber-700">请先保存当前正文，再开始普通对话。</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-[11px] leading-4 text-slate-400">对话已安全保存，可在刷新页面后继续。</p>
    </div>
  </section>;
}
