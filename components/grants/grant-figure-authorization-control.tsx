"use client";

import { useEffect, useState } from "react";

type Projection = {
  sourceRevisionId: string;
  eligibleAssetIds: string[];
  authorization: null | {
    authorizationRevision: number;
    sourceRevisionId: string;
    permissions: { sendImageToModel: boolean; useForSemanticDiagnosis: boolean };
    revokedAt: string | null;
  };
  effectivePermissions: { sendImageToModel: boolean; useForSemanticDiagnosis: boolean };
  requiresRenewal: boolean;
};

export function GrantFigureAuthorizationControl(props: { documentId: string; currentRevisionId: string }) {
  const [projection, setProjection] = useState<Projection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/grants/documents/${props.documentId}/figure-authorization`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "无法读取图片授权状态。");
        if (active) setProjection(data as Projection);
      })
      .catch((nextError) => active && setError(nextError instanceof Error ? nextError.message : "无法读取图片授权状态。"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [props.documentId, props.currentRevisionId]);

  if (loading || !projection || projection.eligibleAssetIds.length === 0) return null;
  const enabled = projection.effectivePermissions.useForSemanticDiagnosis;
  const expectedAuthorizationRevision = projection.authorization?.authorizationRevision ?? 0;

  async function authorize() {
    if (!window.confirm(`是否允许 AI 读取本申请书当前版本中的 ${projection!.eligibleAssetIds.length} 张图片，用于语义诊断？\n\n图片将发送给当前配置的模型供应商；你可以随时撤销授权。`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/grants/documents/${props.documentId}/figure-authorization`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedAuthorizationRevision,
          allowedAssetIds: projection!.eligibleAssetIds,
          permissions: { sendImageToModel: true, useForSemanticDiagnosis: true },
          expiresAt: null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法保存图片授权。");
      setProjection(data as Projection);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法保存图片授权。");
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    try {
      const response = await fetch(`/api/grants/documents/${props.documentId}/figure-authorization`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedAuthorizationRevision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法撤销图片授权。");
      setProjection(data as Projection);
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "无法撤销图片授权。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-800">图片诊断授权</p>
          <p className="mt-1 leading-5 text-slate-500">
            {enabled
              ? `已允许 AI 读取当前版本的 ${projection.eligibleAssetIds.length} 张图片。`
              : projection.requiresRenewal
                ? "正文版本已变化，原图片授权已自动失效，请重新确认。"
                : `当前有 ${projection.eligibleAssetIds.length} 张图片；默认不会发送给 AI。`}
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void (enabled ? revoke() : authorize())}
          className={`shrink-0 rounded-lg px-3 py-2 font-semibold disabled:opacity-50 ${enabled ? "border border-slate-300 bg-white text-slate-700" : "bg-[#155eef] text-white"}`}
        >
          {saving ? "保存中…" : enabled ? "撤销" : "授权读取"}
        </button>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">工作台显示图片不等于授权 AI；授权按当前正文版本绑定。</p>
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
