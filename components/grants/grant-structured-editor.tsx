"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { estimateGrantLength } from "@/lib/grants/application/length-estimator";
import type { CanonicalGrantSnapshot, GrantLengthEstimate, GrantRevisionSummary } from "@/lib/grants/domain/contracts";
import type { GrantFindingFeedback } from "@/lib/grants/feedback/contracts";
import type { GrantAggregate } from "@/lib/grants/ports/grant-revision-repository";
import type { GrantFigureDisplayAsset } from "@/lib/grants/application/figure-display-service";
import { GrantDiagnosticsPanel } from "./grant-diagnostics-panel";
import { GrantDocumentCanvas } from "./grant-document-canvas";
import { GrantDocumentOutline } from "./grant-document-outline";
import { GrantResizableWorkspace } from "./grant-resizable-workspace";
import {
  grantFindingTarget,
  indexGrantFindingsByNode,
  type GrantDiagnosticItem,
  type GrantDiagnosticsPayload,
} from "./grant-diagnostic-view-model";

type EditorPayload = {
  aggregate: GrantAggregate;
  figureAssets: GrantFigureDisplayAsset[];
  estimate: GrantLengthEstimate;
  revisionHistory: GrantRevisionSummary[];
};

type SaveStatus = "loading" | "saved" | "dirty" | "saving" | "offline" | "conflict";

const emptyDiagnostics: GrantDiagnosticsPayload = {
  findings: [],
  conflicts: [],
  feedback: [],
  recheck: { state: "not_run", checkedSectionCount: 0, checkedNodeCount: 0, currentFindingCount: 0, resolvedCount: 0, introducedCount: 0, reusedExecution: false },
  coverage: { deterministic: "not_run", semantic: "not_run", failedCheckerIds: [] },
  executionStatus: null,
};

async function fetchEditorPayload(documentId: string): Promise<EditorPayload> {
  const response = await fetch(`/api/grants/documents/${documentId}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "无法读取申请书。");
  return data as EditorPayload;
}

async function fetchDiagnostics(documentId: string, revisionId: string): Promise<GrantDiagnosticsPayload> {
  const response = await fetch(`/api/grants/documents/${documentId}/diagnostics?targetRevisionId=${encodeURIComponent(revisionId)}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "无法读取问题记录。");
  return data as GrantDiagnosticsPayload;
}

function updateNode(
  snapshot: CanonicalGrantSnapshot,
  nodeId: string,
  updater: (node: CanonicalGrantSnapshot["nodes"][number]) => CanonicalGrantSnapshot["nodes"][number],
) {
  return { ...snapshot, nodes: snapshot.nodes.map((node) => node.nodeId === nodeId ? updater(node) : node) };
}

export function GrantStructuredEditor({ documentId, aiPatchEnabled, evidenceEnabled, evidencePatchEnabled, recheckEnabled, docxExportEnabled }: { documentId: string; aiPatchEnabled: boolean; evidenceEnabled: boolean; evidencePatchEnabled: boolean; recheckEnabled: boolean; docxExportEnabled: boolean }) {
  const [payload, setPayload] = useState<EditorPayload | null>(null);
  const [snapshot, setSnapshot] = useState<CanonicalGrantSnapshot | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<GrantDiagnosticsPayload>(emptyDiagnostics);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [message, setMessage] = useState("");
  const snapshotRef = useRef<CanonicalGrantSnapshot | null>(null);
  const revisionIdRef = useRef("");
  const savedSerializedRef = useRef("");

  const refreshDiagnostics = useCallback(async (revisionId = revisionIdRef.current) => {
    if (!revisionId) return;
    setDiagnosticsLoading(true);
    try {
      setDiagnostics(await fetchDiagnostics(documentId, revisionId));
      setDiagnosticsError("");
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : "无法读取问题记录。");
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [documentId]);

  function applyLoadedPayload(next: EditorPayload) {
    const nextSnapshot = next.aggregate.currentRevision.snapshot;
    setPayload(next);
    setSnapshot(nextSnapshot);
    snapshotRef.current = nextSnapshot;
    revisionIdRef.current = next.aggregate.currentRevision.revisionId;
    savedSerializedRef.current = JSON.stringify(nextSnapshot);
    setSelectedSectionId((current) => current && nextSnapshot.sections.some((section) => section.sectionId === current)
      ? current
      : nextSnapshot.sections[0]?.sectionId ?? null);
    setMessage("");
    setSaveStatus("saved");
  }

  async function loadLatest() {
    setSaveStatus("loading");
    try {
      const next = await fetchEditorPayload(documentId);
      applyLoadedPayload(next);
      await refreshDiagnostics(next.aggregate.currentRevision.revisionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取申请书。");
      setSaveStatus("offline");
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      let next: EditorPayload;
      try {
        next = await fetchEditorPayload(documentId);
        if (!active) return;
        applyLoadedPayload(next);
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "无法读取申请书。");
        setSaveStatus("offline");
        setDiagnosticsLoading(false);
        return;
      }
      try {
        const nextDiagnostics = await fetchDiagnostics(documentId, next.aggregate.currentRevision.revisionId);
        if (active) setDiagnostics(nextDiagnostics);
      } catch (error) {
        if (active) setDiagnosticsError(error instanceof Error ? error.message : "无法读取问题记录。");
      } finally {
        if (active) setDiagnosticsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [documentId]);

  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  useEffect(() => {
    const hasUnsavedChanges = saveStatus === "dirty" || saveStatus === "offline" || saveStatus === "conflict" || saveStatus === "saving";
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [saveStatus]);

  async function saveDocument() {
    const sentSnapshot = snapshotRef.current;
    if (!sentSnapshot || saveStatus === "loading" || saveStatus === "saving" || saveStatus === "conflict") return;
    const sentSerialized = JSON.stringify(sentSnapshot);
    if (sentSerialized === savedSerializedRef.current) {
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/grants/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevisionId: revisionIdRef.current, snapshot: sentSnapshot }),
      });
      const data = await response.json();
      if (response.status === 409) {
        setSaveStatus("conflict");
        setMessage("检测到其他位置已保存新版本。当前未保存内容没有覆盖服务器版本，请加载最新版本后继续。");
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "保存失败。");
      const next = data as EditorPayload;
      revisionIdRef.current = next.aggregate.currentRevision.revisionId;
      savedSerializedRef.current = sentSerialized;
      setPayload(next);
      setSaveStatus(JSON.stringify(snapshotRef.current) === sentSerialized ? "saved" : "dirty");
      void refreshDiagnostics(next.aggregate.currentRevision.revisionId);
    } catch (error) {
      setSaveStatus("offline");
      setMessage(error instanceof Error ? error.message : "保存失败，修改仍保留在当前页面。");
    }
  }

  const estimate = useMemo(() => snapshot && payload
    ? estimateGrantLength(snapshot, payload.aggregate.templateSnapshot.rules)
    : null, [payload, snapshot]);
  const selectedSection = snapshot?.sections.find((section) => section.sectionId === selectedSectionId);
  const findingsByNode = useMemo(() => indexGrantFindingsByNode(diagnostics.findings), [diagnostics.findings]);
  const findingsBySection = useMemo(() => {
    const index = new Map<string, number>();
    if (!snapshot) return index;
    for (const item of diagnostics.findings) {
      const target = grantFindingTarget(item);
      const sectionId = target.nodeId
        ? snapshot.nodes.find((node) => node.nodeId === target.nodeId)?.sectionId
        : item.finding.sourceAnchor.sectionId;
      if (sectionId) index.set(sectionId, (index.get(sectionId) ?? 0) + 1);
    }
    return index;
  }, [diagnostics.findings, snapshot]);

  function mutate(mutator: (current: CanonicalGrantSnapshot) => CanonicalGrantSnapshot) {
    setSnapshot((current) => {
      if (!current) return current;
      const next = mutator(current);
      snapshotRef.current = next;
      setSaveStatus((status) => status === "conflict"
        ? status
        : JSON.stringify(next) === savedSerializedRef.current ? "saved" : "dirty");
      return next;
    });
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

  function changeNodeContent(nodeId: string, value: string) {
    mutate((current) => updateNode(current, nodeId, (node) => {
      if (node.nodeType === "paragraph") return { ...node, content: { text: value } };
      if (node.nodeType === "heading") return { ...node, content: { ...node.content, text: value } };
      if (node.nodeType === "list") return { ...node, content: { ...node.content, items: value.split("\n").filter(Boolean) } };
      if (node.nodeType === "table") return { ...node, content: { rows: value.split("\n").filter(Boolean).map((row) => row.split("\t")) } };
      if (node.nodeType === "formula") return { ...node, content: { latex: value } };
      return node;
    }));
  }

  async function restore(sourceRevisionId: string) {
    const prompt = saveStatus === "saved"
      ? "恢复后会创建一个新版本，当前历史不会被删除。是否继续？"
      : "当前有未保存修改，恢复版本会丢弃这些页面草稿，并创建一个新版本。是否继续？";
    if (!payload || !window.confirm(prompt)) return;
    setSaveStatus("saving");
    const response = await fetch(`/api/grants/documents/${documentId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevisionId: revisionIdRef.current, sourceRevisionId }),
    });
    const data = await response.json();
    if (!response.ok) {
      setSaveStatus(response.status === 409 ? "conflict" : "offline");
      setMessage(data.error ?? "恢复版本失败。");
      return;
    }
    const next = data as EditorPayload;
    applyLoadedPayload(next);
    setMessage("已将所选历史版本恢复为新的当前版本。");
    await refreshDiagnostics(next.aggregate.currentRevision.revisionId);
  }

  async function runDiagnostics() {
    if (saveStatus !== "saved") {
      setDiagnosticsError("请先点击保存，再运行申请书检查。");
      return;
    }
    setDiagnosticsRunning(true);
    setDiagnosticsError("");
    try {
      const mode = recheckEnabled ? "?mode=recheck" : "";
      const response = await fetch(`/api/grants/documents/${documentId}/diagnostics${mode}`, { method: "POST" });
      const data = await response.json();
      await refreshDiagnostics();
      if (data.executionStatus === "failed") {
        throw new Error("AI 诊断未完成，系统没有把失败结果当作完整诊断写入。");
      }
      if (!response.ok) throw new Error(data.error ?? "申请书检查失败。");
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : "申请书检查失败。");
    } finally {
      setDiagnosticsRunning(false);
    }
  }

  function navigateToFinding(item: GrantDiagnosticItem) {
    setSelectedFindingId(item.finding.findingId);
    const target = grantFindingTarget(item);
    if (!target.nodeId) return;
    navigateToDiagnosticNode(target.nodeId, item.finding.findingId);
  }

  function navigateToDiagnosticNode(nodeId: string, findingId: string) {
    setSelectedFindingId(findingId);
    if (!snapshot) return;
    const targetNode = snapshot.nodes.find((node) => node.nodeId === nodeId);
    if (!targetNode) return;
    setSelectedSectionId(targetNode.sectionId);
    window.setTimeout(() => {
      const element = document.getElementById(`grant-node-${nodeId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.querySelector<HTMLElement>("textarea, input, button")?.focus({ preventScroll: true });
    }, 0);
  }

  function navigateFromNode(nodeId: string) {
    const findingId = findingsByNode.get(nodeId)?.[0];
    if (!findingId) return;
    setSelectedFindingId(findingId);
    document.getElementById(`grant-finding-${findingId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function updateFeedback(next: GrantFindingFeedback) {
    setDiagnostics((current) => ({
      ...current,
      feedback: [...current.feedback.filter((item) => item.findingId !== next.findingId), next],
    }));
  }

  if (!payload || !snapshot) {
    return <main className="research-canvas min-h-screen p-10"><p className="text-sm text-slate-600">{message || "正在加载申请书…"}</p></main>;
  }

  const statusLabel = {
    loading: "读取中",
    saved: "已保存",
    dirty: "未保存",
    saving: "保存中…",
    offline: "保存失败",
    conflict: "版本冲突",
  }[saveStatus];

  return (
    <main className="research-canvas min-h-screen xl:flex xl:h-dvh xl:flex-col xl:overflow-hidden">
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white/95 px-5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/grants"
            className="shrink-0 text-sm font-semibold text-[#245d82]"
            onClick={(event) => {
              if (saveStatus !== "saved" && !window.confirm("当前修改尚未保存，确定离开编辑页面吗？")) event.preventDefault();
            }}
          >ResearchGPT</Link>
          <span className="text-slate-300">/</span>
          <input
            aria-label="申请书标题"
            className="research-focus min-w-0 max-w-xl flex-1 rounded-lg border border-transparent px-2 py-1 font-medium text-slate-900 hover:border-slate-200"
            value={snapshot.title}
            onChange={(event) => mutate((current) => ({ ...current, title: event.target.value }))}
          />
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={saveStatus === "saved" ? "text-emerald-700" : saveStatus === "conflict" || saveStatus === "offline" ? "text-red-700" : "text-amber-700"}>{statusLabel}</span>
          <button
            type="button"
            onClick={() => void saveDocument()}
            disabled={saveStatus === "saved" || saveStatus === "loading" || saveStatus === "saving" || saveStatus === "conflict"}
            className="rounded-lg bg-[#155eef] px-4 py-2 font-semibold text-white hover:bg-[#0f4dcc] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {saveStatus === "saving" ? "保存中…" : saveStatus === "offline" ? "重新保存" : "保存"}
          </button>
          <span className="rounded-full bg-slate-100 px-3 py-1.5">版本 {payload.aggregate.document.currentRevisionNumber}</span>
          {docxExportEnabled && (
            <a
              href={`/api/grants/documents/${documentId}/export`}
              className={`rounded-lg border px-3 py-2 font-semibold ${saveStatus === "saved" ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-200 text-slate-300"}`}
              aria-disabled={saveStatus !== "saved"}
            >
              导出 Word
            </a>
          )}
        </div>
      </header>

      {message && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
          {message}
          {saveStatus === "conflict" && <button type="button" className="ml-3 font-semibold underline" onClick={() => void loadLatest()}>加载最新版本</button>}
        </div>
      )}

      <GrantResizableWorkspace
        left={<GrantDocumentOutline
          documentId={documentId}
          evidenceEnabled={evidenceEnabled}
          snapshot={snapshot}
          estimate={estimate}
          selectedSectionId={selectedSectionId}
          findingsBySection={findingsBySection}
          revisionHistory={payload.revisionHistory}
          currentRevisionId={payload.aggregate.currentRevision.revisionId}
          onSelectSection={setSelectedSectionId}
          onRestore={restore}
        />}
        center={<GrantDocumentCanvas
          snapshot={snapshot}
          figureAssets={payload.figureAssets}
          selectedSectionId={selectedSectionId}
          selectedFindingId={selectedFindingId}
          findingsByNode={findingsByNode}
          onSectionTitleChange={(sectionId, title) => {
            mutate((current) => ({
              ...current,
              sections: current.sections.map((section) => section.sectionId === sectionId ? { ...section, title } : section),
            }));
          }}
          onNodeContentChange={changeNodeContent}
          onNodeFindingSelect={navigateFromNode}
          onAddParagraph={addParagraph}
          onRemoveNode={removeNode}
        />}
        right={<GrantDiagnosticsPanel
          documentId={documentId}
          currentRevisionId={payload.aggregate.currentRevision.revisionId}
          aiPatchEnabled={aiPatchEnabled}
          evidencePatchEnabled={evidencePatchEnabled && evidenceEnabled}
          canGeneratePatch={saveStatus === "saved"}
          items={diagnostics.findings}
          feedback={diagnostics.feedback}
          selectedFindingId={selectedFindingId}
          loading={diagnosticsLoading}
          running={diagnosticsRunning}
          error={diagnosticsError}
          recheckEnabled={recheckEnabled}
          recheck={diagnostics.recheck}
          coverage={diagnostics.coverage}
          onRun={runDiagnostics}
          onSelect={navigateToFinding}
          onNavigateNode={navigateToDiagnosticNode}
          onFeedbackChange={updateFeedback}
          onPatchAccepted={loadLatest}
        />}
      />
    </main>
  );
}
