import { PaymentOrderList } from "@/components/account/payment-order-list";

export default function AccountOrdersPage() {
  return <div className="space-y-5"><section className="rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold text-[#172126]">充值订单</h2><p className="mt-2 text-sm leading-6 text-[#607078]">这里展示正式支付机构确认的订单。支付通道尚未开放，因此当前不会产生新订单。</p><p className="mt-3 rounded-xl bg-[#f8fafb] px-4 py-3 text-xs leading-5 text-[#607078]">如果未来出现“已付款但智点未到账”，请保留本页显示的 ResearchGPT 订单号；不要发送银行卡、支付密码或验证码。</p></section><PaymentOrderList /></div>;
}
