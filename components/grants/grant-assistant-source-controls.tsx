"use client";

import { useEffect, useRef, useState } from "react";
import type { GrantEvidenceResource } from "@/lib/grants/evidence/contracts";

export function GrantAssistantSourceControls({ documentId, enabled, selectedSourceIds, onSelectionChange, onError }: {
  documentId: string;
  enabled: boolean;
  selectedSourceIds: string[];
  onSelectionChange: (sourceIds: string[]) => void;
  onError: (message: string) => void;
}) {
  const uploadInput = useRef<HTMLInputElement>(null);
  const [resources, setResources] = useState<GrantEvidenceResource[]>([]);
  const [busy, setBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchSessionId, setSearchSessionId] = useState("");
  const [results, setResults] = useState<Array<{ resultId: string; title: string; snippet: string; provider: string }>>([]);
  const [selectedResults, setSelectedResults] = useState<string[]>([]);

  async function refresh(select: string[] = []) {
    const response = await fetch(`/api/grants/documents/${documentId}/evidence`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "无法读取项目资料。");
    setResources(data as GrantEvidenceResource[]);
    if (select.length > 0) onSelectionChange([...new Set([...selectedSourceIds, ...select])].slice(0, 8));
  }

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetch(`/api/grants/documents/${documentId}/evidence`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法读取项目资料。");
      if (active) setResources(data as GrantEvidenceResource[]);
    }).catch((cause) => active && onError(cause instanceof Error ? cause.message : "无法读取项目资料。"));
    return () => { active = false; };
  }, [documentId, enabled]);

  async function upload(file: File) {
    setBusy(true); onError("");
    try {
      const form = new FormData();
      form.set("file", file); form.set("provenanceType", "project_material"); form.set("sensitivity", "project_confidential");
      const response = await fetch(`/api/grants/documents/${documentId}/evidence`, { method: "POST", body: form });
      const resource = await response.json() as GrantEvidenceResource & { error?: string };
      if (!response.ok) throw new Error(resource.error ?? "本地文件上传失败。");
      const authorization = await fetch(`/api/grants/documents/${documentId}/evidence/${resource.source.sourceId}/authorization`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: resource.authorization.revision, permissions: { read: true, index: true, sendRelevantExcerptToModel: true, useForReasoning: true, useForCitation: false } }),
      });
      const authorizationData = await authorization.json();
      if (!authorization.ok) throw new Error(authorizationData.error ?? "文件已上传，但授权 AI 使用失败。");
      await refresh([resource.source.sourceId]);
    } catch (cause) { onError(cause instanceof Error ? cause.message : "本地文件上传失败。"); }
    finally { setBusy(false); if (uploadInput.current) uploadInput.current.value = ""; }
  }

  async function search() {
    if (query.trim().length < 2 || busy) return;
    setBusy(true); onError("");
    try {
      const response = await fetch(`/api/grants/documents/${documentId}/web-sources/search`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: query.trim() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "学术检索失败。");
      setSearchSessionId(data.searchSessionId); setResults(data.results ?? []); setSelectedResults([]);
    } catch (cause) { onError(cause instanceof Error ? cause.message : "学术检索失败。"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!searchSessionId || selectedResults.length === 0 || busy) return;
    setBusy(true); onError("");
    try {
      const response = await fetch(`/api/grants/documents/${documentId}/web-sources/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ searchSessionId, resultIds: selectedResults }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法绑定所选学术来源。");
      await refresh(data.evidenceSourceIds ?? []); setResults([]); setSelectedResults([]); setSearchOpen(false);
    } catch (cause) { onError(cause instanceof Error ? cause.message : "无法绑定所选学术来源。"); }
    finally { setBusy(false); }
  }

  const available = resources.filter((item) => item.source.status === "active" && item.source.sensitivity !== "highly_sensitive"
    && item.authorization.permissions.sendRelevantExcerptToModel && item.authorization.permissions.useForReasoning);

  return <div className="mb-2 space-y-2">
    <input ref={uploadInput} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!enabled || busy} onClick={() => uploadInput.current?.click()} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">上传/绑定本地文件</button>
      <button type="button" disabled={!enabled || busy} onClick={() => setSearchOpen((value) => !value)} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${searchOpen ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"} disabled:opacity-40`}>学术联网检索</button>
    </div>
    {available.length > 0 && <details className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs"><summary className="cursor-pointer font-medium text-slate-700">选择本轮资料（{selectedSourceIds.length}）</summary><div className="mt-2 max-h-32 space-y-2 overflow-y-auto">{available.map((item) => <label key={item.source.sourceId} className="flex gap-2"><input type="checkbox" checked={selectedSourceIds.includes(item.source.sourceId)} onChange={() => onSelectionChange(selectedSourceIds.includes(item.source.sourceId) ? selectedSourceIds.filter((id) => id !== item.source.sourceId) : [...selectedSourceIds, item.source.sourceId].slice(0, 8))}/><span>{item.source.title}</span></label>)}</div></details>}
    {searchOpen && <div className="rounded-xl border border-blue-200 bg-blue-50 p-2"><div className="flex gap-2"><input aria-label="学术检索关键词" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索论文、方法或研究结论" className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs outline-none"/><button type="button" disabled={busy || query.trim().length < 2} onClick={() => void search()} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">搜索</button></div>{results.length > 0 && <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{results.map((result) => <label key={result.resultId} className="flex gap-2 rounded-lg bg-white p-2 text-xs"><input type="checkbox" checked={selectedResults.includes(result.resultId)} onChange={() => setSelectedResults((ids) => ids.includes(result.resultId) ? ids.filter((id) => id !== result.resultId) : [...ids, result.resultId].slice(0, 5))}/><span><span className="block font-semibold text-slate-800">{result.title}</span><span className="mt-1 block line-clamp-2 text-slate-500">{result.snippet}</span><span className="mt-1 block text-blue-600">{result.provider}</span></span></label>)}<button type="button" disabled={busy || selectedResults.length === 0} onClick={() => void confirm()} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">确认并绑定所选来源</button></div>}<p className="mt-2 text-[11px] text-slate-500">仅检索学术文献；结果经你确认并保存为固定快照后才能进入 AI。</p></div>}
  </div>;
}
