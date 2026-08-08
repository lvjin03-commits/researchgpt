"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { estimateGrantLength } from "@/lib/grants/application/length-estimator";
import type {
  CanonicalGrantSnapshot,
  GrantLengthEstimate,
  GrantRevisionSummary,
} from "@/lib/grants/domain/contracts";
import type { GrantAggregate } from "@/lib/grants/ports/grant-revision-repository";

type EditorPayload = {
  aggregate: GrantAggregate;
  estimate: GrantLengthEstimate;
  revisionHistory: GrantRevisionSummary[];
};

type SaveStatus = "loading" | "saved" | "dirty" | "saving" | "offline" | "conflict";

async function fetchEditorPayload(documentId: string): Promise<EditorPayload> {
  const response = await fetch(`/api/grants/documents/${documentId}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "无法读取申请书。");
  return data as EditorPayload;
}

function updateNode(snapshot: CanonicalGrantSnapshot, nodeId: string, updater: (node: CanonicalGrantSnapshot["nodes"][number]) => CanonicalGrantSnapshot["nodes"][number]) {
  return { ...snapshot, nodes: snapshot.nodes.map((node) => node.nodeId === nodeId ? updater(node) : node) };
}

export function GrantStructuredEditor({ documentId }: { documentId: string }) {
  const [payload, setPayload] = useState<EditorPayload | null>(null);
  const [snapshot, setSnapshot] = useState<CanonicalGrantSnapshot | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [message, setMessage] = useState("");
  const [saveKick, setSaveKick] = useState(0);
  const snapshotRef = useRef<CanonicalGrantSnapshot | null>(null);
  const revisionIdRef = useRef("");
  const savedSerializedRef = useRef("");
  const savingRef = useRef(false);

  async function loadLatest() {
    setSaveStatus("loading");
    try {
      applyLoadedPayload(await fetchEditorPayload(documentId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取申请书。");
      setSaveStatus("offline");
    }
  }

  function applyLoadedPayload(next: EditorPayload) {
    const nextSnapshot = next.aggregate.currentRevision.snapshot;
    setPayload(next);
    setSnapshot(nextSnapshot);
    snapshotRef.current = nextSnapshot;
    revisionIdRef.current = next.aggregate.currentRevision.revisionId;
    savedSerializedRef.current = JSON.stringify(nextSnapshot);
    setSelectedSectionId((current) => current && nextSnapshot.sections.some((section) => section.sectionId === current) ? current : nextSnapshot.sections[0]?.sectionId ?? null);
    setMessage("");
    setSaveStatus("saved");
  }

  useEffect(() => {
    let active = true;
    void fetchEditorPayload(documentId).then((next) => {
      if (active) applyLoadedPayload(next);
    }).catch((error: unknown) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : "无法读取申请书。");
      setSaveStatus("offline");
    });
    return () => { active = false; };
  }, [documentId]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  useEffect(() => {
    if (!snapshot || !payload || saveStatus === "conflict" || saveStatus === "loading") return;
    const serialized = JSON.stringify(snapshot);
    if (serialized === savedSerializedRef.current) {
      if (!savingRef.current) setSaveStatus("saved");
      return;
    }
    setSaveStatus("dirty");
    const timer = window.setTimeout(async () => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaveStatus("saving");
      const sentSnapshot = snapshotRef.current;
      if (!sentSnapshot) return;
      const sentSerialized = JSON.stringify(sentSnapshot);
      try {
        const response = await fetch(`/api/grants/documents/${documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevisionId: revisionIdRef.current, snapshot: sentSnapshot }),
        });
        const data = await response.json();
        if (response.status === 409) {
          setSaveStatus("conflict");
          setMessage("检测到其他位置已保存新版本。当前内容没有覆盖服务器版本，请加载最新版本后继续。");
          return;
        }
        if (!response.ok) throw new Error(data.error ?? "自动保存失败。");
        const next = data as EditorPayload;
        revisionIdRef.current = next.aggregate.currentRevision.revisionId;
        savedSerializedRef.current = sentSerialized;
        setPayload(next);
        setMessage("");
        if (JSON.stringify(snapshotRef.current) === sentSerialized) setSaveStatus("saved");
      } catch (error) {
        setSaveStatus("offline");
        setMessage(error instanceof Error ? error.message : "自动保存失败，内容仍保留在当前页面。" );
      } finally {
        savingRef.current = false;
        if (JSON.stringify(snapshotRef.current) !== savedSerializedRef.current) {
          setSaveKick((value) => value + 1);
        }
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [documentId, payload, saveKick, saveStatus, snapshot]);

  const estimate = useMemo(() => snapshot && payload
    ? estimateGrantLength(snapshot, payload.aggregate.templateSnapshot.rules)
    : null, [payload, snapshot]);
  const selectedSection = snapshot?.sections.find((section) => section.sectionId === selectedSectionId);
  const selectedNodes = selectedSection && snapshot
    ? selectedSection.nodeIds.map((nodeId) => snapshot.nodes.find((node) => node.nodeId === nodeId)).filter(Boolean) as CanonicalGrantSnapshot["nodes"]
    : [];

  function mutate(mutator: (current: CanonicalGrantSnapshot) => CanonicalGrantSnapshot) {
    setSnapshot((current) => current ? mutator(current) : current);
  }

  function addParagraph() {
    if (!snapshot || !selectedSection) return;
    const nodeId = crypto.randomUUID();
    mutate((current) => ({
      ...current,
      sections: current.sections.map((section) => section.sectionId === selectedSection.sectionId
        ? { ...section, nodeIds: [...section.nodeIds, nodeId] }
        : section),
      nodes: [...current.nodes, {
        nodeId,
        sectionId: selectedSection.sectionId,
        order: selectedSection.nodeIds.length,
        nodeType: "paragraph",
        content: { text: "请输入正文" },
      }],
    }));
  }

  function removeNode(nodeId: string) {
    if (!selectedSection) return;
    mutate((current) => {
      const remainingIds = selectedSection.nodeIds.filter((id) => id !== nodeId);
      return {
        ...current,
        sections: current.sections.map((section) => section.sectionId === selectedSection.sectionId ? { ...section, nodeIds: remainingIds } : section),
        nodes: current.nodes.filter((node) => node.nodeId !== nodeId).map((node) => node.sectionId === selectedSection.sectionId
          ? { ...node, order: remainingIds.indexOf(node.nodeId) }
          : node),
      };
    });
  }

  async function restore(sourceRevisionId: string) {
    if (!payload || !window.confirm("恢复后会创建一个新版本，当前历史不会被删除。是否继续？")) return;
    setSaveStatus("saving");
    const response = await fetch(`/api/grants/documents/${documentId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevisionId: revisionIdRef.current, sourceRevisionId }),
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409) setSaveStatus("conflict"); else setSaveStatus("offline");
      setMessage(data.error ?? "恢复版本失败。");
      return;
    }
    const next = data as EditorPayload;
    setPayload(next);
    setSnapshot(next.aggregate.currentRevision.snapshot);
    snapshotRef.current = next.aggregate.currentRevision.snapshot;
    revisionIdRef.current = next.aggregate.currentRevision.revisionId;
    savedSerializedRef.current = JSON.stringify(next.aggregate.currentRevision.snapshot);
    setSaveStatus("saved");
    setMessage("已将所选历史版本恢复为新的当前版本。");
  }

  if (!payload || !snapshot) {
    return <main className="research-canvas min-h-screen p-10"><p className="text-sm text-slate-600">{message || "正在加载申请书…"}</p></main>;
  }

  const statusLabel = {
    loading: "读取中",
    saved: "已保存",
    dirty: "等待保存",
    saving: "保存中…",
    offline: "保存失败",
    conflict: "版本冲突",
  }[saveStatus];

  return (
    <main className="research-canvas min-h-screen">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/grants" className="text-sm font-semibold text-[#245d82]">ResearchGPT</Link>
          <span className="text-slate-300">/</span>
          <input aria-label="申请书标题" className="research-focus min-w-0 max-w-xl flex-1 rounded-lg border border-transparent px-2 py-1 font-medium text-slate-900 hover:border-slate-200" value={snapshot.title} onChange={(event) => mutate((current) => ({ ...current, title: event.target.value }))} />
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className={saveStatus === "saved" ? "text-emerald-700" : saveStatus === "conflict" || saveStatus === "offline" ? "text-red-700" : "text-amber-700"}>{statusLabel}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">版本 {payload.aggregate.document.currentRevisionNumber}</span>
        </div>
      </header>

      {message && <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">{message} {saveStatus === "conflict" && <button className="ml-3 font-semibold underline" onClick={loadLatest}>加载最新版本</button>}</div>}

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-[260px_minmax(0,1fr)_280px]">
        <aside className="border-r border-slate-200 bg-white p-4">
          <p className="research-eyebrow mb-3">文档结构</p>
          <nav className="space-y-1">
            {[...snapshot.sections].sort((a, b) => a.order - b.order).map((section, index) => (
              <button key={section.sectionId} onClick={() => setSelectedSectionId(section.sectionId)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm ${selectedSectionId === section.sectionId ? "bg-blue-50 font-semibold text-[#174866]" : "text-slate-700 hover:bg-slate-50"}`}>
                <span className="w-5 text-xs text-slate-400">{index + 1}</span><span className="truncate">{section.title}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="p-8">
          <div className="mx-auto min-h-[900px] max-w-3xl rounded-sm border border-slate-200 bg-white px-14 py-16 shadow-sm">
            {selectedSection && <>
              <input aria-label="章节标题" className="research-focus mb-8 w-full rounded-lg border border-transparent px-2 py-2 text-2xl font-semibold text-slate-900 hover:border-slate-200" value={selectedSection.title} onChange={(event) => mutate((current) => ({ ...current, sections: current.sections.map((section) => section.sectionId === selectedSection.sectionId ? { ...section, title: event.target.value } : section) }))} />
              <div className="space-y-5">
                {selectedNodes.map((node) => (
                  <div key={node.nodeId} className="group relative rounded-xl border border-transparent p-2 hover:border-slate-200">
                    {node.nodeType === "paragraph" && <textarea aria-label="正文段落" className="research-focus min-h-28 w-full resize-y rounded-lg border border-slate-200 px-4 py-3 leading-7" value={node.content.text} onChange={(event) => mutate((current) => updateNode(current, node.nodeId, (candidate) => candidate.nodeType === "paragraph" ? { ...candidate, content: { text: event.target.value } } : candidate))} />}
                    {node.nodeType === "heading" && <input aria-label="正文标题" className="research-focus w-full rounded-lg border border-slate-200 px-4 py-3 font-semibold" value={node.content.text} onChange={(event) => mutate((current) => updateNode(current, node.nodeId, (candidate) => candidate.nodeType === "heading" ? { ...candidate, content: { ...candidate.content, text: event.target.value } } : candidate))} />}
                    {node.nodeType === "list" && <textarea aria-label="列表内容" className="research-focus min-h-28 w-full rounded-lg border border-slate-200 px-4 py-3" value={node.content.items.join("\n")} onChange={(event) => mutate((current) => updateNode(current, node.nodeId, (candidate) => candidate.nodeType === "list" ? { ...candidate, content: { ...candidate.content, items: event.target.value.split("\n").filter(Boolean) } } : candidate))} />}
                    {node.nodeType === "table" && <textarea aria-label="表格内容" className="research-focus min-h-32 w-full font-mono text-sm rounded-lg border border-slate-200 px-4 py-3" value={node.content.rows.map((row) => row.join("\t")).join("\n")} onChange={(event) => mutate((current) => updateNode(current, node.nodeId, (candidate) => candidate.nodeType === "table" ? { ...candidate, content: { rows: event.target.value.split("\n").filter(Boolean).map((row) => row.split("\t")) } } : candidate))} />}
                    {node.nodeType === "formula" && <input aria-label="公式" className="research-focus w-full rounded-lg border border-slate-200 px-4 py-3 font-mono" value={node.content.latex} onChange={(event) => mutate((current) => updateNode(current, node.nodeId, (candidate) => candidate.nodeType === "formula" ? { ...candidate, content: { latex: event.target.value } } : candidate))} />}
                    {node.nodeType === "figure" && <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">图片资产：{node.content.altText}</div>}
                    {node.nodeType === "citation" && <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">引用：{node.content.referenceId}</div>}
                    <button className="absolute -right-2 -top-2 hidden rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-red-700 shadow-sm group-hover:block" onClick={() => removeNode(node.nodeId)}>删除</button>
                  </div>
                ))}
                <button className="w-full rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-600 hover:border-[#245d82] hover:text-[#245d82]" onClick={addParagraph}>＋ 添加正文段落</button>
              </div>
            </>}
          </div>
        </section>

        <aside className="border-l border-slate-200 bg-white p-4">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="research-eyebrow">篇幅预估</p>
            <p className="mt-3 text-2xl font-semibold text-slate-900">约 {estimate?.estimatedPages ?? 0} 页</p>
            <p className="mt-1 text-xs text-slate-500">{estimate?.visibleCharacters ?? 0} 字符 · 中文 {estimate?.hanCharacters ?? 0} 字 · 英文 {estimate?.latinWords ?? 0} 词</p>
            {estimate?.maximumEstimatedPages && <p className={`mt-2 text-xs ${estimate.exceedsEstimatedLimit ? "text-red-700" : "text-slate-500"}`}>模板预估上限 {estimate.maximumEstimatedPages} 页</p>}
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between"><p className="research-eyebrow">版本记录</p><button className="text-xs text-[#245d82]" onClick={loadLatest}>刷新</button></div>
            <div className="mt-3 space-y-2">
              {payload.revisionHistory.map((revision) => (
                <div key={revision.revisionId} className="rounded-xl border border-slate-200 p-3 text-xs">
                  <div className="flex items-center justify-between"><strong>版本 {revision.revisionNumber}</strong><span className="text-slate-400">{new Date(revision.createdAt).toLocaleString("zh-CN")}</span></div>
                  {revision.revisionId !== payload.aggregate.currentRevision.revisionId && <button className="mt-2 font-medium text-[#245d82]" onClick={() => restore(revision.revisionId)}>恢复为新版本</button>}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
