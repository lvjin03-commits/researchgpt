"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GrantAiEditCandidate, GrantAiEditSession, GrantAiEditTurn } from "@/lib/grants/edit-session/contracts";
import type { GrantEvidenceResource } from "@/lib/grants/evidence/contracts";
import type { GrantFigureDisplayAsset } from "@/lib/grants/application/figure-display-service";
import type { GrantCandidateDiff } from "@/lib/grants/edit-session/candidate-diff";

type Props = {
  documentId: string; currentRevisionId: string; targetNodeId: string; targetText: string;
  findingId?: string; selection?: { startOffset: number; endOffset: number; text: string };
  evidenceEnabled: boolean; figures: GrantFigureDisplayAsset[]; canGenerate: boolean;
  onAccepted: () => Promise<void>; onClose: () => void; onSessionResolved?: (sessionId: string) => void;
  onDiscussCandidate: (input: { editSessionId: string; candidate: GrantAiEditCandidate; prompt: string }) => void;
};

async function textHash(text: string) {
  const bytes = new TextEncoder().encode(JSON.stringify(text));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function GrantAiEditSessionPanel(props: Props) {
  const localFileInput = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<GrantAiEditSession | null>(null);
  const [turns, setTurns] = useState<GrantAiEditTurn[]>([]);
  const [candidates, setCandidates] = useState<GrantAiEditCandidate[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidateInsights, setCandidateInsights] = useState<Record<string, { diff?: GrantCandidateDiff; blockingIssues?: Array<{ code: string; message: string }>; error?: string }>>({});
  const [insightBusyId, setInsightBusyId] = useState("");
  const [expandedCandidateId, setExpandedCandidateId] = useState("");
  const [evidence, setEvidence] = useState<GrantEvidenceResource[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedFigures, setSelectedFigures] = useState<string[]>([]);
  const [sourceMode, setSourceMode] = useState<"none" | "web">("none");
  const [webQuery, setWebQuery] = useState("");
  const [webSessionId, setWebSessionId] = useState("");
  const [webResults, setWebResults] = useState<Array<{ resultId: string; title: string; url: string; snippet: string; provider: string }>>([]);
  const [selectedWebResults, setSelectedWebResults] = useState<string[]>([]);
  const storageKey = `grant-ai-edit-session:${props.documentId}:${props.targetNodeId}:${props.currentRevisionId}`;

  useEffect(() => {
    setSession(null); setTurns([]); setCandidates([]); setInstruction(""); setError(""); setCandidateInsights({}); setExpandedCandidateId(""); setSelectedSources([]); setSelectedFigures([]);
    const savedSessionId = window.sessionStorage.getItem(storageKey);
    if (!savedSessionId) return;
    let active = true;
    void fetch(`/api/grants/documents/${props.documentId}/edit-sessions/${savedSessionId}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "无法恢复 AI 修改会话。");
      if (active) { setSession(data.session); setTurns(data.turns); setCandidates(data.candidates); props.onSessionResolved?.(data.session.sessionId); }
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

  async function refreshEvidence(selectIds: string[] = []) {
    const response = await fetch(`/api/grants/documents/${props.documentId}/evidence`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "无法读取项目资料。");
    setEvidence(data as GrantEvidenceResource[]);
    if (selectIds.length > 0) setSelectedSources((ids) => [...new Set([...ids, ...selectIds])]);
  }

  async function uploadLocalFile(file: File) {
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.set("file", file); form.set("provenanceType", "project_material"); form.set("sensitivity", "project_confidential");
      const response = await fetch(`/api/grants/documents/${props.documentId}/evidence`, { method: "POST", body: form });
      const resource = await response.json() as GrantEvidenceResource & { error?: string };
      if (!response.ok) throw new Error(resource.error ?? "本地文件上传失败。");
      const authorizationResponse = await fetch(`/api/grants/documents/${props.documentId}/evidence/${resource.source.sourceId}/authorization`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: resource.authorization.revision, permissions: { read: true, index: true, sendRelevantExcerptToModel: true, useForReasoning: true, useForCitation: false } }),
      });
      const authorizationData = await authorizationResponse.json();
      if (!authorizationResponse.ok) throw new Error(authorizationData.error ?? "文件已上传，但授权 AI 使用失败。");
      await refreshEvidence([resource.source.sourceId]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "本地文件上传失败。"); }
    finally { setBusy(false); if (localFileInput.current) localFileInput.current.value = ""; }
  }

  async function searchWeb() {
    if (webQuery.trim().length < 2 || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/grants/documents/${props.documentId}/web-sources/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: webQuery.trim() }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "联网搜索失败。");
      setWebSessionId(data.searchSessionId); setWebResults(data.results ?? []); setSelectedWebResults([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "联网搜索失败。"); }
    finally { setBusy(false); }
  }

  async function confirmWebSources() {
    if (!webSessionId || selectedWebResults.length === 0 || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/grants/documents/${props.documentId}/web-sources/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchSessionId: webSessionId, resultIds: selectedWebResults }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "无法绑定所选联网来源。");
      await refreshEvidence(data.evidenceSourceIds ?? []); setWebResults([]); setSelectedWebResults([]); setSourceMode("none");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法绑定所选联网来源。"); }
    finally { setBusy(false); }
  }

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
    setSession(data as GrantAiEditSession); window.sessionStorage.setItem(storageKey, data.sessionId); props.onSessionResolved?.(data.sessionId); return data as GrantAiEditSession;
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

  function diffUrl(candidateId: string) {
    return `/api/grants/documents/${props.documentId}/edit-sessions/${session!.sessionId}/candidates/${candidateId}/diff`;
  }

  async function viewDiff(candidate: GrantAiEditCandidate) {
    if (!session || insightBusyId) return;
    if (candidateInsights[candidate.candidateId]?.diff) {
      setExpandedCandidateId((current) => current === candidate.candidateId ? "" : candidate.candidateId);
      return;
    }
    setInsightBusyId(candidate.candidateId);
    try {
      const response = await fetch(diffUrl(candidate.candidateId), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法计算候选稿差异。");
      setCandidateInsights((items) => ({ ...items, [candidate.candidateId]: { ...items[candidate.candidateId], diff: data.diff, blockingIssues: data.blockingIssues, error: undefined } }));
      setExpandedCandidateId(candidate.candidateId);
    } catch (cause) {
      setCandidateInsights((items) => ({ ...items, [candidate.candidateId]: { ...items[candidate.candidateId], error: cause instanceof Error ? cause.message : "无法计算候选稿差异。" } }));
    } finally { setInsightBusyId(""); }
  }

  function renderCandidate(candidate: GrantAiEditCandidate) {
    const insight = candidateInsights[candidate.candidateId];
    const expanded = expandedCandidateId === candidate.candidateId;
    const blockingIssues = insight?.blockingIssues ?? [];
    return <div key={candidate.candidateId} className="rounded-2xl rounded-bl-md border border-slate-200 bg-white p-3">
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{candidate.text}</p>
      {blockingIssues.length > 0 && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2" role="alert"><p className="text-xs font-semibold text-red-800">此版本当前不能应用</p>{blockingIssues.map((issue) => <p key={issue.code} className="mt-1 text-xs leading-5 text-red-700">{issue.message}</p>)}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`mr-auto text-xs ${candidate.safetyState === "passed" ? "text-emerald-700" : candidate.safetyState === "needs_confirmation" ? "text-amber-700" : "text-red-700"}`}>{candidate.safetyState === "passed" ? "安全检查通过" : candidate.safetyState === "needs_confirmation" ? "有新增事实需要依据" : "此版本不可应用"}</span>
        <button type="button" disabled={insightBusyId === candidate.candidateId} onClick={() => void viewDiff(candidate)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">{expanded && insight?.diff ? "收起差异" : "查看差异"}</button>
        {session && <button type="button" onClick={() => props.onDiscussCandidate({ editSessionId: session.sessionId, candidate, prompt: "为什么这样修改？" })} className="rounded-lg border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700">在对话中讨论</button>}
        {candidate.candidateId === session?.activeCandidateId && <button type="button" disabled={candidate.safetyState !== "passed" || busy} onClick={() => void apply(candidate)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">应用到正文</button>}
      </div>
      {insight?.error && <p className="mt-2 text-xs text-red-700">{insight.error}</p>}
      {expanded && insight?.diff && <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <p className="text-xs font-semibold text-slate-700">程序差异：替换 {insight.diff.counts.replacements} · 新增 {insight.diff.counts.insertions} · 删除 {insight.diff.counts.deletions} · 移动 {insight.diff.counts.moves}</p>
        {insight.diff.changes.map((change, index) => <div key={`${change.kind}-${index}`} className="rounded-lg bg-slate-50 p-2 text-xs leading-5 text-slate-700">
          <p className="mb-1 font-semibold text-slate-600">{change.kind === "replace" ? "替换" : change.kind === "insert" ? "新增" : change.kind === "delete" ? "删除" : "移动"}</p>
          {change.kind === "replace" ? <p>{change.spans.map((span, spanIndex) => <span key={spanIndex} className={span.kind === "insert" ? "bg-emerald-100 text-emerald-900" : span.kind === "delete" ? "bg-red-100 text-red-800 line-through" : ""}>{span.text}</span>)}</p> : <p className="whitespace-pre-wrap">{change.kind === "insert" ? change.newText : change.kind === "delete" ? change.oldText : change.text}</p>}
        </div>)}
      </div>}
    </div>;
  }

  return <section aria-label="AI 多轮修改" className="relative flex max-h-[72vh] min-h-[520px] flex-col overflow-hidden">
    <button type="button" aria-label="关闭 AI 修改" title="关闭" className="absolute right-0 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={props.onClose}>×</button>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
      {conversation.length === 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">告诉 AI 你希望如何修改。它不会直接覆盖正文，你可以继续追问和调整。</div>}
      {conversation.map((message) => message.kind === "user"
        ? <div key={message.id} className="ml-8 rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-sm text-white">{message.text}</div>
        : renderCandidate(message.candidate))}
    </div>
    <div className="border-t border-slate-200 pt-3">
      <input ref={localFileInput} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(event) => event.target.files?.[0] && void uploadLocalFile(event.target.files[0])} />
      <div className="mb-2 flex flex-wrap gap-2">
        <button type="button" disabled={!props.evidenceEnabled || busy} onClick={() => localFileInput.current?.click()} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">上传/绑定本地文件</button>
        <button type="button" disabled={!props.evidenceEnabled || busy} onClick={() => setSourceMode((mode) => mode === "web" ? "none" : "web")} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${sourceMode === "web" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"} disabled:opacity-40`}>联网搜索</button>
      </div>
      {sourceMode === "web" && <div className="mb-2 rounded-xl border border-blue-200 bg-blue-50 p-2">
        <div className="flex gap-2"><input aria-label="联网搜索关键词" value={webQuery} onChange={(event) => setWebQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchWeb(); } }} placeholder="搜索论文、方法或研究结论" className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs outline-none"/><button type="button" disabled={busy || webQuery.trim().length < 2} onClick={() => void searchWeb()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">搜索</button></div>
        {webResults.length > 0 && <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{webResults.map((result) => <label key={result.resultId} className="flex gap-2 rounded-lg bg-white p-2 text-xs"><input type="checkbox" checked={selectedWebResults.includes(result.resultId)} onChange={() => setSelectedWebResults((ids) => ids.includes(result.resultId) ? ids.filter((id) => id !== result.resultId) : [...ids, result.resultId])}/><span className="min-w-0"><span className="block font-semibold text-slate-800">{result.title}</span><span className="mt-1 block line-clamp-2 text-slate-500">{result.snippet}</span><span className="mt-1 block text-blue-600">{result.provider}</span></span></label>)}<button type="button" disabled={busy || selectedWebResults.length === 0} onClick={() => void confirmWebSources()} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">确认并绑定所选来源</button></div>}
        <p className="mt-2 text-[11px] leading-4 text-slate-500">搜索结果不会直接进入 AI；只有你确认的来源才会保存为固定证据快照。</p>
      </div>}
      {(availableEvidence.length > 0 || readyFigures.length > 0) && <details className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs"><summary className="cursor-pointer font-medium text-slate-700">添加资料或图片</summary><div className="mt-2 space-y-2">{availableEvidence.map((item) => <label key={item.source.sourceId} className="flex gap-2"><input type="checkbox" checked={selectedSources.includes(item.source.sourceId)} onChange={() => setSelectedSources((ids) => ids.includes(item.source.sourceId) ? ids.filter((id) => id !== item.source.sourceId) : [...ids, item.source.sourceId])}/><span>{item.source.title}</span></label>)}{readyFigures.map((item, index) => <label key={item.assetId} className="flex gap-2"><input type="checkbox" checked={selectedFigures.includes(item.assetId)} onChange={() => setSelectedFigures((ids) => ids.includes(item.assetId) ? ids.filter((id) => id !== item.assetId) : [...ids, item.assetId])}/><span>正文图片 {index + 1}（勾选即授权用于本次 AI 修改）</span></label>)}</div></details>}
      <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-2 focus-within:border-blue-500"><textarea aria-label="向 AI 发送修改要求" value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={session ? "继续修改，例如：保留结构，但让论证更紧凑" : "例如：增强逻辑衔接，不要增加新数据"} className="min-h-16 flex-1 resize-none border-0 px-2 py-1 text-sm outline-none"/><button type="button" disabled={!instruction.trim() || busy || !props.canGenerate} onClick={() => void send()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{busy ? "处理中…" : "发送"}</button></div>
      {!props.canGenerate && <p className="mt-2 text-xs text-amber-700">请先保存当前正文，再开始 AI 修改。</p>}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  </section>;
}
