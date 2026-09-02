import Link from "next/link";
import { PointStatementView } from "@/components/account/point-statement-view";

export default function AccountPointsPage() {
  const paymentMode = process.env.ALIPAY_PAYMENT_MODE;
  const sandboxEnabled = paymentMode === "sandbox";
  const paymentEnabled = sandboxEnabled || paymentMode === "production";

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[#172126]">智点账户</h2>
          <p className="mt-1 text-sm text-[#607078]">
            查看余额和最近记录。
            {sandboxEnabled
              ? "当前仅开放支付宝沙箱测试，不会产生真实扣款。"
              : paymentEnabled
                ? "现已支持支付宝在线充值。"
                : "充值功能将在正式支付通道接入后开放。"}
          </p>
        </div>
        <span
          className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
            sandboxEnabled
              ? "bg-amber-100 text-amber-800"
              : paymentEnabled
                ? "bg-emerald-100 text-emerald-800"
                : "bg-[#f1f4f5] text-[#607078]"
          }`}
        >
          {sandboxEnabled
            ? "支付宝沙箱"
            : paymentEnabled
              ? "支付宝充值"
              : "充值即将开放"}
        </span>
      </section>

      {paymentEnabled ? (
        <section
          className={`rounded-2xl border p-5 ${
            sandboxEnabled
              ? "border-amber-200 bg-amber-50"
              : "border-[#dbe4e7] bg-white"
          }`}
        >
          <h3 className="font-semibold text-[#172126]">
            {sandboxEnabled ? "购买测试智点" : "购买智点"}
          </h3>
          <p
            className={`mt-1 text-sm ${
              sandboxEnabled ? "text-amber-900" : "text-[#607078]"
            }`}
          >
            {sandboxEnabled
              ? "仅用于支付宝开放平台沙箱链路测试。请使用沙箱买家账号，不要使用真实支付宝账户。"
              : "提交后将创建真实支付宝订单，请在支付宝收银台确认金额后完成付款。"}
          </p>
          <form
            action="/api/account/payments/alipay/checkout"
            method="post"
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label className="text-sm font-medium text-[#33454d]">
              购买智点数
              <input
                name="requestedPoints"
                type="number"
                required
                min="1"
                max="100000"
                defaultValue="100"
                className="mt-1 block w-full rounded-xl border border-[#cdd9de] bg-white px-3 py-2 sm:w-48"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-[#174866] px-5 py-2.5 text-sm font-semibold text-white"
            >
              {sandboxEnabled ? "前往支付宝沙箱" : "前往支付宝付款"}
            </button>
          </form>
        </section>
      ) : null}

      <PointStatementView mode="summary" />
      <Link
        href="/account/transactions"
        className="inline-flex text-sm font-semibold text-[#174866] hover:underline"
      >
        查看全部智点明细 →
      </Link>
    </div>
  );
}
