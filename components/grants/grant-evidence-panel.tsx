"use client";

import { useEffect, useRef, useState } from "react";
import type { GrantEvidencePermissions, GrantEvidenceResource } from "@/lib/grants/evidence/contracts";

const permissionLabels: Array<[keyof GrantEvidencePermissions, string]> = [
  ["read", "允许平台读取"],
  ["index", "允许建立证据卡"],
  ["sendRelevantExcerptToModel", "允许将相关摘录发送给 AI"],
  ["useForReasoning", "允许 AI 用于分析推理"],
  ["useForCitation", "允许作为引用依据"],
];

const provenanceLabels = {
  published_literature: "第三方已发表文献",
  own_unpublished_work: "申请人未发表前期成果",
  project_material: "其他项目资料",
} as const;

function EvidenceResourceCard(props: {
  documentId: string;
  resource: GrantEvidenceResource;
  onChanged: () => Promise<void>;
}) {
  const [permissions, setPermissions] = useState(props.resource.authorization.permissions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = props.resource.source.status === "active";

  function toggle(key: keyof GrantEvidencePermissions, checked: boolean) {
    setPermissions((current) => {
      const next = { ...current, [key]: checked };
      if (!next.read || !next.index) {
        next.sendRelevantExcerptToModel = false;
        next.useForReasoning = false;
        next.useForCitation = false;
      }
      if (!next.sendRelevantExcerptToModel) next.useForReasoning = false;
      if (key === "useForReasoning" && checked) {
        next.read = true;
        next.index = true;
        next.sendRelevantExcerptToModel = true;
      }
      if ((key === "sendRelevantExcerptToModel" || key === "useForCitation") && checked) {
        next.read = true;
        next.index = true;
      }
      return next;
    });
  }

  async function request(path: string, init: RequestInit) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/grants/documents/${props.documentId}/evidence/${props.resource.source.sourceId}${path}`, init);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法处理项目资料。");
      await props.onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法处理项目资料。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{props.resource.source.title}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {provenanceLabels[props.resource.source.provenanceType]} · {props.resource.cards.length} 张证据卡
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
          {active ? "可用" : props.resource.source.status === "revoked" ? "已撤权" : "删除中"}
        </span>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-[#245d82]">查看证据卡与授权</summary>
        <div className="mt-2 space-y-2">
          {props.resource.cards.slice(0, 3).map((card) => (
            <blockquote key={card.cardId} className="max-h-32 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              {card.excerpt}
            </blockquote>
          ))}
          {props.resource.cards.length > 3 && <p className="text-xs text-slate-400">另有 {props.resource.cards.length - 3} 张证据卡</p>}
          <div className="space-y-1.5 border-t border-slate-100 pt-2">
            {permissionLabels.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs leading-5 text-slate-700">
                <input type="checkbox" checked={permissions[key]} disabled={!active || busy} onChange={(event) => toggle(key, event.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          {active && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void request("/authorization", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expectedRevision: props.resource.authorization.revision, permissions }),
              })}
              className="w-full rounded-lg bg-[#245d82] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >保存授权</button>
          )}
          <div className="flex gap-2">
            {active && (
              <button
                type="button"
                disabled={busy}
                onClick={() => window.confirm("撤权后，排队任务、缓存和未接受提案都不能继续使用这份资料。是否继续？") && void request("/revoke", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ expectedRevision: props.resource.authorization.revision }),
                })}
                className="flex-1 rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
              >撤销全部授权</button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => window.confirm("删除会清除原始文件和证据摘录，且无法恢复。是否继续？") && void request("", { method: "DELETE" })}
              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
            >删除</button>
          </div>
          {error && <p role="alert" className="text-xs leading-5 text-red-700">{error}</p>}
        </div>
      </details>
    </article>
  );
}

export function GrantEvidencePanel({ documentId, enabled }: { documentId: string; enabled: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [resources, setResources] = useState<GrantEvidenceResource[]>([]);
  const [provenanceType, setProvenanceType] = useState<keyof typeof provenanceLabels>("published_literature");
  const [sensitivity, setSensitivity] = useState("project_confidential");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    if (!enabled) return;
    const response = await fetch(`/api/grants/documents/${documentId}/evidence`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "无法读取项目资料。");
    setResources(data as GrantEvidenceResource[]);
  }

  useEffect(() => { void refresh().catch((next) => setError(next instanceof Error ? next.message : "无法读取项目资料。")); }, [documentId, enabled]);
  if (!enabled) return null;

  async function upload(file: File) {
    if (!window.confirm("这份本地资料是否用于支撑申请书内容？上传后默认不会发送给 AI，必须由你单独授权。")) {
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("provenanceType", provenanceType);
      form.set("sensitivity", sensitivity);
      const response = await fetch(`/api/grants/documents/${documentId}/evidence`, { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "项目资料上传失败。");
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "项目资料上传失败。");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <section className="mt-6 border-t border-slate-200 pt-4" aria-label="项目资料">
      <div className="flex items-center justify-between">
        <p className="research-eyebrow">项目资料</p>
        <span className="text-xs text-slate-400">{resources.length} 项</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">资料不会自动进入 AI。读取、推理与引用权限相互独立。</p>
      <div className="mt-3 grid gap-2">
        <select value={provenanceType} onChange={(event) => setProvenanceType(event.target.value as keyof typeof provenanceLabels)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          {Object.entries(provenanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={sensitivity} onChange={(event) => setSensitivity(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="public">公开资料</option>
          <option value="project_confidential">项目机密资料</option>
          <option value="unpublished_research">未发表研究</option>
          <option value="highly_sensitive">高度敏感</option>
        </select>
        <input ref={fileInput} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} />
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="rounded-lg border border-[#245d82] px-3 py-2 text-sm font-semibold text-[#245d82] disabled:opacity-50">
          {busy ? "解析并保存中…" : "+ 上传本地资料"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p>}
      <div className="mt-3 space-y-2">
        {resources.map((resource) => <EvidenceResourceCard key={resource.source.sourceId} documentId={documentId} resource={resource} onChanged={refresh} />)}
      </div>
    </section>
  );
}
