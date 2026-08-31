import Link from "next/link";

export default function AlipayPaymentReturnPage() {
  return <section className="rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm">
    <h2 className="text-xl font-semibold text-[#172126]">正在确认支付宝沙箱付款</h2>
    <p className="mt-2 text-sm leading-6 text-[#607078]">浏览器返回不代表智点已经到账。系统只会在收到并验证支付宝异步通知后充值，请返回智点账户查看最新余额和订单状态。</p>
    <Link href="/account/points" className="mt-5 inline-flex rounded-xl bg-[#174866] px-4 py-2 text-sm font-semibold text-white">返回智点账户</Link>
  </section>;
}
