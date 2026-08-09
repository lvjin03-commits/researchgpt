"use client";

import { useState } from "react";
import type { GrantPatchProposal } from "@/lib/grants/patching/contracts";

type Props = {
  documentId: string;
  currentRevisionId: string;
  findingId: string;
  targetNodeId?: string;
  enabled: boolean;
  canGenerate: boolean;
  onAccepted: () => Promise<void>;
};

export function GrantAiPatchPanel(props: Props) {
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<GrantPatchProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!props.enabled) return null;
  const operation = proposal?.operations[0];

  async function generate() {
    if (!props.targetNodeId || !instruction.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/grants/documents/${props.documentId}/patches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevisionId: props.currentRevisionId,
          targetNodeId: props.targetNodeId,
          findingId: props.findingId,
          instruction,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法生成修改提案。");
      setProposal(data as GrantPatchProposal);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法生成修改提案。");
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "accept" | "reject") {
    if (!proposal) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/grants/documents/${props.documentId}/patches/${proposal.proposalId}/${action}`,
        { method: "POST" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法处理修改提案。");
      if (action === "accept") await props.onAccepted();
      setProposal(null);
      setInstruction("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法处理修改提案。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
      <label className="text-xs font-semibold text-slate-800" htmlFor={`grant-ai-instruction-${props.findingId}`}>
        指挥 AI 如何修改
      </label>
      <textarea
        id={`grant-ai-instruction-${props.findingId}`}
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder="例如：强化科学问题与前期结果的逻辑连接，但不要增加新结论。"
        className="research-focus mt-2 min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
      />
      <button
        type="button"
        disabled={busy || !props.canGenerate || !props.targetNodeId || !instruction.trim()}
        onClick={() => void generate()}
        className="mt-2 w-full rounded-lg bg-[#155eef] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? "处理中…" : proposal ? "重新生成修改预览" : "生成修改预览"}
      </button>
      {!props.targetNodeId && <p className="mt-2 text-xs text-amber-700">该问题当前无法精确定位，不能自动修改。</p>}
      {!props.canGenerate && <p className="mt-2 text-xs text-amber-700">请先等待当前编辑保存完成，再生成修改提案。</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}

      {operation && (
        <div className="mt-3 space-y-2" aria-label="AI 修改差异预览">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-[11px] font-semibold text-red-700">修改前</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">{operation.oldText}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-[11px] font-semibold text-emerald-700">修改后</p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">{operation.newText}</p>
          </div>
          {proposal?.rationale && <p className="text-xs leading-5 text-slate-600">说明：{proposal.rationale}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void decide("accept")} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">接受并写入</button>
            <button type="button" disabled={busy} onClick={() => void decide("reject")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">拒绝</button>
          </div>
          <p className="text-[11px] leading-4 text-amber-700">AI 仅生成预览；确认后才创建新版本。</p>
        </div>
      )}
    </section>
  );
}
