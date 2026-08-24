import Link from "next/link";
import { PointStatementView } from "@/components/account/point-statement-view";

export default function AccountPointsPage() {
  return <div className="space-y-5"><section className="flex flex-col gap-3 rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-semibold text-[#172126]">智点账户</h2><p className="mt-1 text-sm text-[#607078]">查看余额和最近记录。充值功能将在正式支付通道接入后开放。</p></div><span className="inline-flex w-fit rounded-full bg-[#f1f4f5] px-3 py-1 text-xs font-semibold text-[#607078]">充值即将开放</span></section><PointStatementView mode="summary" /><Link href="/account/transactions" className="inline-flex text-sm font-semibold text-[#174866] hover:underline">查看全部智点明细 →</Link></div>;
}
