"use client";

import { useEffect, useMemo, useState } from "react";
import type { GrantAiEditCandidate, GrantAiEditSession, GrantAiEditTurn } from "@/lib/grants/edit-session/contracts";
import type { GrantEvidenceResource } from "@/lib/grants/evidence/contracts";
import type { GrantFigureDisplayAsset } from "@/lib/grants/application/figure-display-service";

type Props = {
  documentId: string; currentRevisionId: string; targetNodeId: string; targetText: string;
  findingId?: string; selection?: { startOffset: number; endOffset: number; text: string };
  evidenceEnabled: boolean; figures: GrantFigureDisplayAsset[]; canGenerate: boolean;
  onAccepted: () => Promise<void>; onClose: () => void;
};

async function textHash(text: string) {
  const bytes = new TextEncoder().encode(JSON.stringify(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function GrantAiEditSessionPanel(props: Props) {
  const [session, setSession] = useState<GrantAiEditSession | null>(null);
  const [turns, setTurns] = useState<GrantAiEditTurn[]>([]);
  const [candidates, setCandidates] = useState<GrantAiEditCandidate[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [evidence, setEvidence] = useState<GrantEvidenceResource[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedFigures, setSelectedFigures] = useState<string[]>([]);
  const storageKey = `grant-ai-edit-session:${props.documentId}:${props.targetNodeId}:${props.currentRevisionId}`;

  useEffect(() => {
    setSession(null); setTurns([]); setCandidates([]); setInstruction(""); setError(""); setSelectedSources([]); setSelectedFigures([]);
    const savedSessionId = window.sessionStorage.getItem(storageKey);
    if (!savedSessionId) return;
    let active = true;
    void fetch(`/api/grants/documents/${props.documentId}/edit-sessions/${savedSessionId}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "无法恢复 AI 修改会话。");
      if (active) { setSession(data.session); setTurns(data.turns); setCandidates(data.candidates); }
    }).catch(() => window.sessionStorage.removeItem(storageKey));
    return () => { active = false; };
  }, [storageKey, props.documentId, props.selection?.startOffset, props.selection?.endOffset]);

  useEffect(() => {
    if (!props.evidenceEnabled) return;
    let active = true;
    void fetch(`/api/grants/documents/${props.documentId}/evidence`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "无法读取项目资料。");
      if (active) setEvidence(data as GrantEvidenceResource[]);
    }).catch((cause) => active && setError(cause instanceof Error ? cause.message : "无法读取项目资料。"));
    return () => { active = false; };
  }, [props.documentId, props.evidenceEnabled]);

  const availableEvidence = evidence.filter((item) => item.source.status === "active"
    && item.authorization.permissions.sendRelevantExcerptToModel && item.authorization.permissions.useForReasoning);
  const readyFigures = props.figures.filter((figure) => figure.status === "ready");
  const conversation = useMemo(() => turns.flatMap((turn) => {
    const candidate = candidates.find((item) => item.producedByTurnId === turn.turnId);
    return [{ kind: "user" as const, id: turn.turnId, text: turn.instruction }, ...(candidate ? [{ kind: "assistant" as const, id: candidate.candidateId, candidate }] : [])];
  }), [turns, candidates]);

  async function ensureSession() {
    if (session) return session;
    const mode = props.selection?.text ? "replace_selection" as const : "replace" as const;
    const response = await fetch(`/api/grants/documents/${props.documentId}/edit-sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        baseRevisionId: props.currentRevisionId, targetNodeId: props.targetNodeId,
        expectedNodeHash: await textHash(props.targetText), editMode: mode, originFindingId: props.findingId,
        selectedText: props.selection?.text, selectionStart: props.selection?.startOffset, selectionEnd: props.selection?.endOffset,
      }),
    });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "无法创建 AI 修改会话。");
    setSession(data as GrantAiEditSession); window.sessionStorage.setItem(storageKey, data.sessionId); return data as GrantAiEditSession;
  }

  async function authorizeSelectedFigures() {
    if (selectedFigures.length === 0) return;
    const currentResponse = await fetch(`/api/grants/documents/${props.documentId}/figure-authorization`, { cache: "no-store" });
    const current = await currentResponse.json(); if (!currentResponse.ok) throw new Error(current.error ?? "无法读取图片授权。");
    const previousIds = (current.authorization?.allowedAssetIds ?? []) as string[];
    const response = await fetch(`/api/grants/documents/${props.documentId}/figure-authorization`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        expectedAuthorizationRevision: current.authorization?.authorizationRevision ?? 0,
        allowedAssetIds: [...new Set([...previousIds, ...selectedFigures])],
        permissions: { sendImageToModel: true, useForSemanticDiagnosis: Boolean(current.effectivePermissions?.useForSemanticDiagnosis), useForAiEditing: true },
        expiresAt: current.authorization?.expiresAt ?? null,
      }),
    });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "无法授权 AI 使用所选图片。");
  }

  async function send() {
    if (!instruction.trim() || busy || !props.canGenerate) return;
    setBusy(true); setError("");
    try {
      await authorizeSelectedFigures();
      const current = await ensureSession();
      const response = await fetch(`/api/grants/documents/${props.documentId}/edit-sessions/${current.sessionId}/turns`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction: instruction.trim(), evidenceSourceIds: selectedSources, figureAssetIds: selectedFigures }),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "AI 修改失败。");
      setTurns((items) => [...items, { turnId: data.turnId, sessionId: current.sessionId, traceId: data.traceId, instruction: instruction.trim(), status: "succeeded", createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }]);
      setCandidates((items) => [...items, data.candidate as GrantAiEditCandidate]);
      setSession((value) => value ? { ...value, activeCandidateId: data.candidate.candidateId } : value);
      setInstruction("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI 修改失败。"); }
    finally { setBusy(false); }
  }

  async function apply(candidate: GrantAiEditCandidate) {
    if (!session || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/grants/documents/${props.documentId}/edit-sessions/${session.sessionId}/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId: candidate.candidateId }),
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "无法应用候选稿。");
      window.sessionStorage.removeItem(storageKey); await props.onAccepted(); props.onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法应用候选稿。"); }
    finally { setBusy(false); }
  }

  return <section aria-label="AI 多轮修改" className="flex max-h-[72vh] min-h-[520px] flex-col overflow-hidden">
    <header className="flex items-start justify-between border-b border-slate-200 pb-3">
      <div><h3 className="text-sm font-semibold text-slate-900">AI 修改对话</h3><p className="mt-1 text-xs text-slate-500">基于上一版继续调整，满意后再应用到正文。</p></div>
      <button type="button" className="text-xs text-slate-500" onClick={props.onClose}>关闭</button>
    </header>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
      {conversation.length === 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">告诉 AI 你希望如何修改。它不会直接覆盖正文，你可以继续追问和调整。</div>}
      {conversation.map((message) => message.kind === "user"
        ? <div key={message.id} className="ml-8 rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-sm text-white">{message.text}</div>
        : <div key={message.id} className="rounded-2xl rounded-bl-md border border-slate-200 bg-white p-3"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{message.candidate.text}</p><div className="mt-3 flex items-center justify-between gap-2"><span className={`text-xs ${message.candidate.safetyState === "passed" ? "text-emerald-700" : message.candidate.safetyState === "needs_confirmation" ? "text-amber-700" : "text-red-700"}`}>{message.candidate.safetyState === "passed" ? "安全检查通过" : message.candidate.safetyState === "needs_confirmation" ? "有新增事实需要依据" : "此版本不可应用"}</span>{message.candidate.candidateId === session?.activeCandidateId && <button type="button" disabled={message.candidate.safetyState !== "passed" || busy} onClick={() => void apply(message.candidate)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">应用到正文</button>}</div></div>)}
    </div>
    <div className="border-t border-slate-200 pt-3">
      {(availableEvidence.length > 0 || readyFigures.length > 0) && <details className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs"><summary className="cursor-pointer font-medium text-slate-700">添加资料或图片</summary><div className="mt-2 space-y-2">{availableEvidence.map((item) => <label key={item.source.sourceId} className="flex gap-2"><input type="checkbox" checked={selectedSources.includes(item.source.sourceId)} onChange={() => setSelectedSources((ids) => ids.includes(item.source.sourceId) ? ids.filter((id) => id !== item.source.sourceId) : [...ids, item.source.sourceId])}/><span>{item.source.title}</span></label>)}{readyFigures.map((item, index) => <label key={item.assetId} className="flex gap-2"><input type="checkbox" checked={selectedFigures.includes(item.assetId)} onChange={() => setSelectedFigures((ids) => ids.includes(item.assetId) ? ids.filter((id) => id !== item.assetId) : [...ids, item.assetId])}/><span>正文图片 {index + 1}（勾选即授权用于本次 AI 修改）</span></label>)}</div></details>}
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-blue-500"><textarea aria-label="向 AI 发送修改要求" value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={session ? "继续修改，例如：保留结构，但让论证更紧凑" : "例如：增强逻辑衔接，不要增加新数据"} className="min-h-16 flex-1 resize-none border-0 px-2 py-1 text-sm outline-none"/><button type="button" disabled={!instruction.trim() || busy || !props.canGenerate} onClick={() => void send()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy ? "处理中…" : "发送"}</button></div>
      {!props.canGenerate && <p className="mt-2 text-xs text-amber-700">请先保存当前正文，再开始 AI 修改。</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  </section>;
}
