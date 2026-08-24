"use client";

import { useEffect, useMemo, useState } from "react";
import type { PointPaymentOrder, PointPaymentOrderPage } from "@/lib/billing/domain/payment-contracts";

const money = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" });
const integer = new Intl.NumberFormat("zh-CN");
const FILTERS = [
  ["all", "全部"], ["pending", "处理中"], ["paid", "已到账"],
  ["failed", "失败"], ["closed", "已关闭"], ["reversed", "已冲正"],
] as const;

export function PaymentOrderList() {
  const [status, setStatus] = useState<(typeof FILTERS)[number][0]>("all");
  const [orders, setOrders] = useState<PointPaymentOrder[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: "30" });
    if (status !== "all") params.set("status", status);
    return params;
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/account/orders?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("orders_unavailable"); return response.json() as Promise<PointPaymentOrderPage>; })
      .then((page) => { setOrders(page.orders); setCursor(page.nextCursor); })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError("订单记录暂时无法读取，请稍后重试。");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [query]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true); setError(null);
    const nextQuery = new URLSearchParams(query); nextQuery.set("cursor", cursor);
    try {
      const response = await fetch(`/api/account/orders?${nextQuery}`, { cache: "no-store" });
      if (!response.ok) throw new Error("orders_unavailable");
      const page = await response.json() as PointPaymentOrderPage;
      setOrders((current) => [...current, ...page.orders]); setCursor(page.nextCursor);
    } catch { setError("下一页订单暂时无法读取，请稍后重试。"); }
    finally { setLoading(false); }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[#dbe4e7] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#e8eef0] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-[#172126]">订单记录</h2><p className="mt-1 text-xs text-[#718087]">订单状态只认支付机构验签结果。</p></div>
        <div className="flex flex-wrap gap-1">{FILTERS.map(([value,label]) => <button key={value} type="button" onClick={() => setStatus(value)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${status===value ? "bg-[#174866] text-white" : "bg-[#f1f4f5] text-[#607078]"}`}>{label}</button>)}</div>
      </div>
      {error && <p className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</p>}
      <div className="divide-y divide-[#edf1f2]">
        {orders.map((order) => <OrderRow key={order.orderId} order={order} />)}
        {!loading && !error && orders.length===0 && <p className="px-5 py-12 text-center text-sm text-[#718087]">暂无订单记录</p>}
        {loading && orders.length===0 && <p className="px-5 py-12 text-center text-sm text-[#718087]">正在读取订单…</p>}
      </div>
      {cursor && <div className="border-t border-[#e8eef0] p-4 text-center"><button type="button" disabled={loading} onClick={() => void loadMore()} className="rounded-xl border border-[#cbd9de] px-4 py-2 text-sm font-semibold text-[#174866] disabled:opacity-50">{loading ? "正在加载…" : "加载更多"}</button></div>}
    </section>
  );
}

function OrderRow({ order }: { order: PointPaymentOrder }) {
  const status = orderStatus(order);
  return <div className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"><div className="min-w-0"><p className="truncate font-mono text-xs text-[#607078]">{order.orderId}</p><p className="mt-1 text-xs text-[#718087]">{new Date(order.createdAt).toLocaleString("zh-CN")}</p></div><div className="text-sm"><p className="font-semibold text-[#172126]">{integer.format(order.purchasedPoints)} 智点</p>{order.bonusPoints>0 && <p className="text-xs text-emerald-700">赠送 {integer.format(order.bonusPoints)}</p>}<p className="mt-1 text-xs text-[#718087]">{money.format(order.amountMinorUnits/100)}</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span></div>;
}

function orderStatus(order: PointPaymentOrder) {
  if (order.status === "paid") return { label: "已到账", className: "bg-emerald-50 text-emerald-700" };
  if (order.status === "pending") {
    const old = Date.now()-new Date(order.createdAt).getTime()>30*60*1000;
    return { label: old ? "确认超时" : "等待确认", className: old ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-700" };
  }
  if (order.status === "reversed") return { label: "已冲正", className: "bg-red-50 text-red-700" };
  if (order.status === "failed") return { label: "支付失败", className: "bg-red-50 text-red-700" };
  return { label: "已关闭", className: "bg-slate-100 text-slate-600" };
}
