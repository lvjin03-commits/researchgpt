"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { GrantDocument } from "@/lib/grants/domain/contracts";
import type { GrantDocxImportPreview } from "@/lib/grants/imports/contracts";

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
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<GrantDocxImportPreview | null>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "previewing" | "ready" | "confirming" | "error">("idle");
  const [importMessage, setImportMessage] = useState("");

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

  async function deleteDocument(document: GrantDocument) {
    const confirmed = window.confirm(`确定删除申请书“${document.title}”吗？\n\n删除后将从列表中移除，历史数据会暂时保留以防误删。`);
    if (!confirmed) return;
    setDeletingDocumentId(document.documentId);
    setDeleteMessage("");
    try {
      const response = await fetch(`/api/grants/documents/${document.documentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevisionId: document.currentRevisionId }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "删除申请书失败。");
      }
      setDocuments((current) => current.filter((item) => item.documentId !== document.documentId));
    } catch (error) {
      setDeleteMessage(error instanceof Error ? error.message : "删除申请书失败。");
    } finally {
      setDeletingDocumentId(null);
    }
  }

  async function previewImport() {
    if (!importFile) return;
    setImportStatus("previewing");
    setImportMessage("");
    const form = new FormData();
    form.append("file", importFile);
    const response = await fetch("/api/grants/imports/preview", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) {
      setImportPreview(null);
      setImportMessage(data.error ?? "无法解析初稿。");
      setImportStatus("error");
      return;
    }
    setImportPreview((data as { preview: GrantDocxImportPreview }).preview);
    setImportStatus("ready");
  }

  async function confirmImport() {
    if (!importFile || !importPreview) return;
    setImportStatus("confirming");
    setImportMessage("");
    const form = new FormData();
    form.append("file", importFile);
    const response = await fetch("/api/grants/imports/confirm", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) {
      setImportMessage(data.error ?? "导入初稿失败。");
      setImportStatus("error");
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
          <p className="mt-2 text-sm text-slate-600">结构化编辑、用户确认保存与可恢复版本。AI诊断和修改建议将在后续阶段接入。</p>
        </header>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="research-surface rounded-2xl p-5">
            <p className="research-eyebrow">从空白开始</p>
            <label className="mt-2 block text-sm font-medium text-slate-800" htmlFor="grant-title">新建申请书</label>
            <div className="mt-3 space-y-3">
              <input id="grant-title" className="research-focus w-full rounded-xl border border-slate-300 px-4 py-3" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
              <button className="w-full rounded-xl bg-[#174866] px-5 py-3 font-medium text-white disabled:opacity-50" disabled={status === "creating" || !title.trim()} onClick={createDocument}>
                {status === "creating" ? "正在创建…" : "创建空白项目"}
              </button>
            </div>
            {message && <p className="mt-3 text-sm text-red-700">{message}</p>}
          </section>

          <section className="research-surface rounded-2xl border-[#9dc4d7] p-5">
            <p className="research-eyebrow">已有初稿</p>
            <h2 className="mt-2 text-base font-semibold text-slate-900">上传 Word 初稿</h2>
            <p className="mt-1 text-sm text-slate-600">先解析并核对章节和表格，确认后才创建正式申请书。</p>
            <input
              className="research-focus mt-4 block w-full rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm"
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(event) => {
                setImportFile(event.target.files?.[0] ?? null);
                setImportPreview(null);
                setImportMessage("");
                setImportStatus("idle");
              }}
            />
            <button
              className="mt-3 w-full rounded-xl border border-[#245d82] px-5 py-3 font-medium text-[#174866] disabled:opacity-50"
              disabled={!importFile || importStatus === "previewing" || importStatus === "confirming"}
              onClick={previewImport}
            >
              {importStatus === "previewing" ? "正在解析初稿…" : "解析并预览"}
            </button>
            {importMessage && <p className="mt-3 text-sm text-red-700">{importMessage}</p>}
          </section>
        </div>

        {importPreview && (
          <section className="research-surface rounded-2xl border-[#79afc8] p-5" aria-live="polite">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="research-eyebrow">导入预览</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">{importPreview.draft.title}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  识别 {importPreview.summary.sectionCount} 个章节、{importPreview.summary.paragraphCount} 个段落、{importPreview.summary.listCount} 个列表、{importPreview.summary.tableCount} 个表格
                </p>
              </div>
              <button
                className="rounded-xl bg-[#174866] px-5 py-3 font-medium text-white disabled:opacity-50"
                disabled={importStatus === "confirming"}
                onClick={confirmImport}
              >
                {importStatus === "confirming" ? "正在创建…" : "确认导入并开始编辑"}
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">识别到的结构</h3>
                <ol className="mt-2 max-h-48 space-y-1 overflow-auto rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                  {importPreview.draft.sections.map((section) => <li key={section.localKey}>{section.title}</li>)}
                </ol>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">保真提示</h3>
                {importPreview.warnings.length === 0 ? (
                  <p className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">未发现需要特别确认的版式元素。</p>
                ) : (
                  <ul className="mt-2 max-h-48 space-y-2 overflow-auto rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    {importPreview.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>• {warning.message}</li>)}
                  </ul>
                )}
              </div>
            </div>
            <p className="mt-4 text-xs text-slate-500">原始 Word 文件将私密保存。页面版式、页眉页脚和浮动对象不会被误当作可编辑正文。</p>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">我的申请书</h2>
          {deleteMessage && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{deleteMessage}</p>}
          {status === "loading" && <p className="text-sm text-slate-500">正在读取…</p>}
          {status === "ready" && documents.length === 0 && <div className="research-surface rounded-2xl p-8 text-center text-sm text-slate-500">还没有申请书，请先创建一个项目。</div>}
          {documents.map((document) => (
            <article key={document.documentId} className="research-surface flex items-center justify-between gap-4 rounded-2xl p-5 transition hover:border-[#245d82]">
              <div className="min-w-0">
                <h3 className="break-words font-semibold text-slate-900">{document.title}</h3>
                <p className="mt-1 text-xs text-slate-500">版本 {document.currentRevisionNumber} · 更新于 {new Date(document.updatedAt).toLocaleString("zh-CN")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={deletingDocumentId === document.documentId}
                  aria-label={`删除申请书“${document.title}”`}
                  onClick={() => void deleteDocument(document)}
                >
                  {deletingDocumentId === document.documentId ? "删除中…" : "删除"}
                </button>
                <Link href={`/grants/${document.documentId}`} className="rounded-lg px-3 py-2 text-sm font-medium text-[#245d82] hover:bg-sky-50">
                  继续编辑 →
                </Link>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
