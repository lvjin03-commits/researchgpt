"use client";

import { useEffect, useMemo, useState } from "react";
import type { PointStatement, PointStatementEntry, PointStatementFilter } from "@/lib/billing/domain/statements";

const integer = new Intl.NumberFormat("zh-CN");
const FILTERS: Array<{ value: "all" | PointStatementFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "grant", label: "获得" },
  { value: "settle", label: "消费" },
  { value: "reserve", label: "预占" },
  { value: "release", label: "释放" },
  { value: "reversal", label: "冲正" },
];

export function PointStatementView({ mode }: { mode: "summary" | "detail" }) {
  const [kind, setKind] = useState<"all" | PointStatementFilter>("all");
  const [statement, setStatement] = useState<PointStatement | null>(null);
  const [entries, setEntries] = useState<PointStatementEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = mode === "summary" ? 8 : 30;

  const query = useMemo(() => {
    const value = new URLSearchParams({ limit: String(limit) });
    if (kind !== "all") value.set("kind", kind);
    return value;
  }, [kind, limit]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/account/statement?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("statement_unavailable");
        return response.json() as Promise<PointStatement>;
      })
      .then((next) => { setStatement(next); setEntries(next.entries); setCursor(next.nextCursor); })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError("智点明细暂时无法读取，请稍后重试。");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [query]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    const nextQuery = new URLSearchParams(query);
    nextQuery.set("cursor", cursor);
    try {
      const response = await fetch(`/api/account/statement?${nextQuery}`, { cache: "no-store" });
      if (!response.ok) throw new Error("statement_unavailable");
      const next = await response.json() as PointStatement;
      setStatement(next);
      setEntries((current) => [...current, ...next.entries]);
      setCursor(next.nextCursor);
    } catch {
      setError("下一页明细暂时无法读取，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {mode === "summary" && (
        <section className="grid gap-3 sm:grid-cols-3">
          <BalanceCard label="可用智点" value={statement?.availablePoints} />
          <BalanceCard label="处理中" value={statement?.reservedPoints} />
          <BalanceCard label="累计消费" value={statement?.lifetimeSpentPoints} />
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-[#dbe4e7] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#e8eef0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-[#172126]">{mode === "summary" ? "最近智点记录" : "智点明细"}</h2>
            <p className="mt-1 text-xs text-[#718087]">余额和记录均来自统一智点账本。</p>
          </div>
          {mode === "detail" && (
            <div className="flex flex-wrap gap-1" aria-label="明细筛选">
              {FILTERS.map((filter) => (
                <button key={filter.value} type="button" onClick={() => setKind(filter.value)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${kind === filter.value ? "bg-[#174866] text-white" : "bg-[#f1f4f5] text-[#607078] hover:bg-[#e5ecef]"}`}>{filter.label}</button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</p>}
        <div className="divide-y divide-[#edf1f2]">
          {entries.map((entry) => <StatementRow key={entry.transactionId} entry={entry} />)}
          {!loading && !error && entries.length === 0 && <p className="px-5 py-12 text-center text-sm text-[#718087]">暂无智点记录</p>}
          {loading && entries.length === 0 && <p className="px-5 py-12 text-center text-sm text-[#718087]">正在读取智点记录…</p>}
        </div>
        {mode === "detail" && cursor && (
          <div className="border-t border-[#e8eef0] p-4 text-center">
            <button type="button" onClick={() => void loadMore()} disabled={loading} className="rounded-xl border border-[#cbd9de] px-4 py-2 text-sm font-semibold text-[#174866] hover:bg-[#f1f6f8] disabled:opacity-50">{loading ? "正在加载…" : "加载更多"}</button>
          </div>
        )}
      </section>
    </div>
  );
}

function BalanceCard({ label, value }: { label: string; value: number | undefined }) {
  return <section className="rounded-2xl border border-[#dbe4e7] bg-white p-5 shadow-sm"><p className="text-xs font-semibold text-[#718087]">{label}</p><p className="mt-2 text-2xl font-bold text-[#174866]">{value === undefined ? "--" : integer.format(value)}</p></section>;
}

function StatementRow({ entry }: { entry: PointStatementEntry }) {
  const presentation = presentEntry(entry);
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[#172126]">{presentation.title}</p>
        <p className="mt-1 text-xs text-[#718087]">{new Date(entry.occurredAt).toLocaleString("zh-CN")} · {presentation.detail}</p>
      </div>
      <p className={`shrink-0 text-sm font-bold ${presentation.delta > 0 ? "text-emerald-700" : presentation.delta < 0 ? "text-[#c43d32]" : "text-[#607078]"}`}>{presentation.delta > 0 ? "+" : ""}{integer.format(presentation.delta)}</p>
    </div>
  );
}

function presentEntry(entry: PointStatementEntry): { title: string; detail: string; delta: number } {
  const operation = operationLabel(entry.operation);
  switch (entry.kind) {
    case "grant": return { title: entry.grantKind === "purchased" ? "购买智点到账" : entry.grantKind === "purchase_bonus" ? "充值赠送" : "体验智点", detail: entry.paymentOrderId ? `订单 ${entry.paymentOrderId}` : entry.reason, delta: entry.availableDelta };
    case "reserve": return { title: operation, detail: "任务已预占", delta: entry.availableDelta };
    case "settle": return { title: operation, detail: "已交付并结算", delta: -Math.abs(entry.spentDelta) };
    case "release": return { title: operation, detail: "未消费部分已释放", delta: entry.availableDelta };
    case "reversal": return { title: "支付冲正", detail: entry.reason, delta: entry.availableDelta };
  }
}

function operationLabel(operation: string | null): string {
  if (!operation) return "智点账户调整";
  if (operation.startsWith("grant." ) || operation.startsWith("diagnostic.")) return "国自然 AI 服务";
  if (operation.startsWith("chat.")) return "研究助手";
  if (operation.startsWith("document.") || operation.includes("outline") || operation.includes("component")) return "文档生成";
  return "AI 服务";
}
