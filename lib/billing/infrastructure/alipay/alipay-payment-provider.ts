import { AlipaySdk } from "alipay-sdk";
import { VerifiedPaymentEventSchema, type PointPaymentOrder } from "../../domain/payment-contracts.ts";
import type { PaymentCheckout, PaymentProvider } from "../../ports/payment-provider.ts";

export const ALIPAY_SANDBOX_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
export const ALIPAY_PRODUCTION_GATEWAY = "https://openapi.alipay.com/gateway.do";
const PAID_STATUSES = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);

export type AlipayPaymentMode = "sandbox" | "production";
export type AlipaySdkPort = Pick<AlipaySdk, "pageExec" | "checkNotifySignV2" | "exec">;
export type AlipayPaymentConfig = {
  mode: AlipayPaymentMode;
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  sellerId: string;
  notifyUrl: string;
  returnUrl: string;
  gateway?: string;
};

function requireValue(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Alipay ${name} is required.`);
  return normalized;
}

function requireGateway(mode: AlipayPaymentMode, gateway?: string) {
  const expected = mode === "sandbox" ? ALIPAY_SANDBOX_GATEWAY : ALIPAY_PRODUCTION_GATEWAY;
  const actual = (gateway ?? expected).trim();
  if (actual !== expected) throw new Error(`Alipay ${mode} adapter refuses the configured gateway.`);
  return actual;
}

export function minorUnitsToYuan(minorUnits: number) {
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) throw new Error("Invalid payment amount.");
  return `${Math.floor(minorUnits / 100)}.${String(minorUnits % 100).padStart(2, "0")}`;
}

export function yuanToMinorUnits(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid Alipay payment amount.");
  const [yuan, fraction = ""] = value.split(".");
  const minor = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("Invalid Alipay payment amount.");
  return minor;
}

function alipayTimeToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid Alipay notification time.");
  const [, year, month, day, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`).toISOString();
}

function parseFormBody(rawBody: Uint8Array) {
  const params = new URLSearchParams(Buffer.from(rawBody).toString("utf8"));
  const values: Record<string, string> = {};
  for (const [key, value] of params) values[key] = value;
  return values;
}

export class AlipayPaymentProvider implements PaymentProvider {
  readonly providerId: string;
  readonly merchantAccountId: string;
  readonly gateway: string;
  private readonly appId: string;
  private readonly notifyUrl: string;
  private readonly returnUrl: string;
  private readonly sdk: AlipaySdkPort;

  constructor(config: AlipayPaymentConfig, sdk?: AlipaySdkPort) {
    this.providerId = config.mode === "sandbox" ? "alipay_sandbox" : "alipay";
    this.appId = requireValue(config.appId, "app ID");
    this.merchantAccountId = requireValue(config.sellerId, "seller ID");
    this.notifyUrl = requireValue(config.notifyUrl, "notification URL");
    this.returnUrl = requireValue(config.returnUrl, "return URL");
    this.gateway = requireGateway(config.mode, config.gateway);
    this.sdk = sdk ?? new AlipaySdk({
      appId: this.appId,
      privateKey: requireValue(config.privateKey, "private key"),
      alipayPublicKey: requireValue(config.alipayPublicKey, "public key"),
      gateway: this.gateway,
      signType: "RSA2",
      keyType: config.privateKey.includes("BEGIN PRIVATE KEY") ? "PKCS8" : "PKCS1",
      camelcase: false,
    });
  }

  async createCheckout(order: PointPaymentOrder): Promise<PaymentCheckout> {
    const checkoutUrl = this.sdk.pageExec("alipay.trade.page.pay", "GET", {
      return_url: this.returnUrl,
      notify_url: this.notifyUrl,
      bizContent: {
        out_trade_no: order.orderId,
        total_amount: minorUnitsToYuan(order.amountMinorUnits),
        subject: `ResearchGPT 智点充值 ${order.purchasedPoints} 点`,
        product_code: "FAST_INSTANT_TRADE_PAY",
      },
    });
    if (!checkoutUrl.startsWith(`${this.gateway}?`)) throw new Error("Alipay SDK produced an unexpected checkout URL.");
    return { providerOrderId: order.orderId, checkoutKind: "redirect", checkoutUrl,
      expiresAt: new Date(Date.parse(order.createdAt) + 15 * 60_000).toISOString() };
  }

  async verifyWebhook(input: { rawBody: Uint8Array; headers: Headers }) {
    const payload = parseFormBody(input.rawBody);
    if (!this.sdk.checkNotifySignV2(payload)) throw new Error("Alipay notification signature is invalid.");
    if (payload.app_id !== this.appId) throw new Error("Alipay notification application mismatch.");
    if (payload.seller_id !== this.merchantAccountId) throw new Error("Alipay notification seller mismatch.");
    if (!PAID_STATUSES.has(payload.trade_status)) throw new Error("Alipay notification is not a paid event.");
    if (payload.out_biz_no || payload.gmt_refund || payload.refund_fee) throw new Error("Refund or split events cannot be accepted as payments.");
    const orderId = requireValue(payload.out_trade_no ?? "", "merchant order ID");
    const providerEventId = requireValue(payload.notify_id ?? "", "notification ID");
    const tradeNo = requireValue(payload.trade_no ?? "", "trade number");
    return VerifiedPaymentEventSchema.parse({
      providerEventId, provider: this.providerId, eventKind: "payment_succeeded",
      merchantAccountId: this.merchantAccountId, providerOrderId: orderId, orderId,
      amountMinorUnits: yuanToMinorUnits(requireValue(payload.total_amount ?? "", "amount")), currency: "CNY",
      occurredAt: alipayTimeToIso(payload.gmt_payment ?? payload.notify_time ?? ""),
      audit: { appId: this.appId, sellerId: this.merchantAccountId, tradeNo, tradeStatus: payload.trade_status },
    });
  }

  async querySuccessfulPayment(order: PointPaymentOrder) {
    if (order.provider !== this.providerId || order.merchantAccountId !== this.merchantAccountId) {
      throw new Error("Payment order does not belong to the configured Alipay merchant.");
    }
    const result = await this.sdk.exec("alipay.trade.query", { bizContent: { out_trade_no: order.orderId } }, { validateSign: true });
    if (result.code !== "10000") {
      if (result.sub_code === "ACQ.TRADE_NOT_EXIST") return null;
      throw new Error(`Alipay trade query failed: ${result.sub_code ?? result.code}.`);
    }
    if (!PAID_STATUSES.has(String(result.trade_status ?? ""))) return null;
    if (String(result.out_trade_no ?? "") !== order.orderId) throw new Error("Alipay trade query order mismatch.");
    if (result.seller_id && String(result.seller_id) !== this.merchantAccountId) throw new Error("Alipay trade query seller mismatch.");
    const tradeNo = requireValue(String(result.trade_no ?? ""), "trade number");
    return VerifiedPaymentEventSchema.parse({
      providerEventId: `alipay-query:${tradeNo}`, provider: this.providerId, eventKind: "payment_succeeded",
      merchantAccountId: this.merchantAccountId, providerOrderId: order.orderId, orderId: order.orderId,
      amountMinorUnits: yuanToMinorUnits(requireValue(String(result.total_amount ?? ""), "amount")), currency: "CNY",
      occurredAt: result.send_pay_date ? alipayTimeToIso(String(result.send_pay_date)) : new Date().toISOString(),
      audit: { appId: this.appId, sellerId: this.merchantAccountId, tradeNo,
        tradeStatus: String(result.trade_status), confirmationSource: "alipay.trade.query" },
    });
  }
}
