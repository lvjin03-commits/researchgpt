"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GrantDocument } from "@/lib/grants/domain/contracts";

async function fetchGrantDocuments(): Promise<GrantDocument[]> {
  const response = await fetch("/api/grants/documents", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? "请先登录后使用国自然协作工作台。" : "无法读取申请书列表。");
  return (data as { documents: GrantDocument[] }).documents;
}

export function GrantDocumentList() {
  const [documents, setDocuments] = useState<GrantDocument[]>([]);
  const [title, setTitle] = useState("2027 国家自然科学基金申请书");
  const [status, setStatus] = useState<"loading" | "ready" | "creating" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetchGrantDocuments().then((next) => {
      if (!active) return;
      setDocuments(next);
      setStatus("ready");
    }).catch((error: unknown) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : "无法读取申请书列表。");
      setStatus("error");
    });
    return () => { active = false; };
  }, []);

  async function createDocument() {
    if (!title.trim()) return;
    setStatus("creating");
    const response = await fetch("/api/grants/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error ?? "创建申请书失败。");
      setStatus("error");
      return;
    }
    window.location.assign(`/grants/${data.aggregate.document.documentId}`);
  }

  return (
    <main className="research-canvas min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-8">
        <header>
          <p className="research-eyebrow">ResearchGPT · Grant Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">国自然申请书协作工作台</h1>
          <p className="mt-2 text-sm text-slate-600">结构化编辑、自动保存与可恢复版本。AI诊断和修改建议将在后续阶段接入。</p>
        </header>

        <section className="research-surface rounded-2xl p-5">
          <label className="text-sm font-medium text-slate-800" htmlFor="grant-title">新建申请书</label>
          <div className="mt-3 flex gap-3">
            <input id="grant-title" className="research-focus min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
            <button className="rounded-xl bg-[#174866] px-5 py-3 font-medium text-white disabled:opacity-50" disabled={status === "creating" || !title.trim()} onClick={createDocument}>
              {status === "creating" ? "正在创建…" : "创建项目"}
            </button>
          </div>
          {message && <p className="mt-3 text-sm text-red-700">{message}</p>}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">我的申请书</h2>
          {status === "loading" && <p className="text-sm text-slate-500">正在读取…</p>}
          {status === "ready" && documents.length === 0 && <div className="research-surface rounded-2xl p-8 text-center text-sm text-slate-500">还没有申请书，请先创建一个项目。</div>}
          {documents.map((document) => (
            <Link key={document.documentId} href={`/grants/${document.documentId}`} className="research-surface flex items-center justify-between rounded-2xl p-5 transition hover:border-[#245d82]">
              <div>
                <h3 className="font-semibold text-slate-900">{document.title}</h3>
                <p className="mt-1 text-xs text-slate-500">版本 {document.currentRevisionNumber} · 更新于 {new Date(document.updatedAt).toLocaleString("zh-CN")}</p>
              </div>
              <span className="text-sm font-medium text-[#245d82]">继续编辑 →</span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
