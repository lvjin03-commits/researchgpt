import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAccountAdminClient } from "@/lib/account/server/admin-client";
import { alipayPaymentMode, createAlipayPaymentService } from "@/lib/billing/server/alipay-composition";

export const dynamic = "force-dynamic";

export default async function AlipayPaymentReturnPage({ searchParams }: { searchParams: Promise<{ out_trade_no?: string }> }) {
  const orderId = String((await searchParams).out_trade_no ?? "").trim();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  let state: "paid" | "pending" | "invalid" | "error" = "invalid";
  if (user && orderId) {
    try {
      const result = await createAlipayPaymentService(createAccountAdminClient()).reconcileOrder({ orderId, ownerId: user.id });
      state = result.status === "paid" ? "paid" : "pending";
    } catch (error) {
      console.error("[alipay-return] reconciliation failed", error instanceof Error ? error.message : "unknown");
      state = "error";
    }
  }
  const copy = state === "paid"
    ? "支付宝已确认付款，智点已经到账。"
    : state === "pending"
      ? "支付宝暂未返回已付款状态，请稍后刷新本页或返回智点账户查看。"
      : state === "invalid"
        ? "缺少可确认的订单，或登录状态已失效。"
        : "支付结果查询暂时失败，请稍后刷新本页；系统不会重复入账。";
  const sandbox = alipayPaymentMode() === "sandbox";
  return <section className="rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm">
    <h2 className="text-xl font-semibold text-[#172126]">{state === "paid" ? `支付宝${sandbox ? "沙箱" : ""}付款成功` : `正在确认支付宝${sandbox ? "沙箱" : ""}付款`}</h2>
    <p className="mt-2 text-sm leading-6 text-[#607078]">{copy}</p>
    <Link href="/account/points" className="mt-5 inline-flex rounded-xl bg-[#174866] px-4 py-2 text-sm font-semibold text-white">返回智点账户</Link>
  </section>;
}
