import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { randomUUID } from "node:crypto";
import { AlipaySdk } from "alipay-sdk";

process.env.ALIPAY_PAYMENT_MODE = "sandbox";

const { AlipaySandboxPaymentProvider, ALIPAY_SANDBOX_GATEWAY, minorUnitsToYuan, yuanToMinorUnits } = await import("../lib/billing/infrastructure/alipay/alipay-sandbox-payment-provider.ts");
const { AlipayPaymentProvider, ALIPAY_PRODUCTION_GATEWAY } = await import("../lib/billing/infrastructure/alipay/alipay-payment-provider.ts");

function keyPair() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKey: pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function signatureContent(payload: Record<string, string>) {
  return Object.entries(payload)
    .filter(([key, value]) => key !== "sign" && key !== "sign_type" && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

const applicationKeys = keyPair();
const alipayKeys = keyPair();
const appId = "9021000000000000";
const sellerId = "2088000000000000";
const sdk = new AlipaySdk({
  appId,
  privateKey: applicationKeys.privateKey,
  alipayPublicKey: alipayKeys.publicKey,
  gateway: ALIPAY_SANDBOX_GATEWAY,
  signType: "RSA2",
  keyType: "PKCS1",
  camelcase: false,
});
const provider = new AlipaySandboxPaymentProvider({
  appId,
  sellerId,
  privateKey: applicationKeys.privateKey,
  alipayPublicKey: alipayKeys.publicKey,
  gateway: ALIPAY_SANDBOX_GATEWAY,
  notifyUrl: "https://preview.example.test/api/payments/alipay/notify",
  returnUrl: "https://preview.example.test/account/points/payment-return",
}, sdk);

assert.equal(minorUnitsToYuan(1), "0.01");
assert.equal(minorUnitsToYuan(316), "3.16");
assert.equal(yuanToMinorUnits("3.16"), 316);
assert.throws(() => yuanToMinorUnits("3.161"));
assert.throws(() => new AlipaySandboxPaymentProvider({
  appId, sellerId, privateKey: applicationKeys.privateKey, alipayPublicKey: alipayKeys.publicKey,
  gateway: "https://openapi.alipay.com/gateway.do",
  notifyUrl: "https://preview.example.test/notify", returnUrl: "https://preview.example.test/return",
}, sdk));
assert.throws(() => new AlipayPaymentProvider({
  mode: "production", appId, sellerId, privateKey: applicationKeys.privateKey,
  alipayPublicKey: alipayKeys.publicKey, gateway: ALIPAY_SANDBOX_GATEWAY,
  notifyUrl: "https://researchgpt.example/notify", returnUrl: "https://researchgpt.example/return",
}, sdk), /production adapter refuses/);
assert.throws(() => new AlipayPaymentProvider({
  mode: "sandbox", appId, sellerId, privateKey: applicationKeys.privateKey,
  alipayPublicKey: alipayKeys.publicKey, gateway: ALIPAY_PRODUCTION_GATEWAY,
  notifyUrl: "https://researchgpt.example/notify", returnUrl: "https://researchgpt.example/return",
}, sdk), /sandbox adapter refuses/);

const productionSdk = new AlipaySdk({
  appId, privateKey: applicationKeys.privateKey, alipayPublicKey: alipayKeys.publicKey,
  gateway: ALIPAY_PRODUCTION_GATEWAY, signType: "RSA2", keyType: "PKCS1", camelcase: false,
});
const productionProvider = new AlipayPaymentProvider({
  mode: "production", appId, sellerId, privateKey: applicationKeys.privateKey,
  alipayPublicKey: alipayKeys.publicKey, gateway: ALIPAY_PRODUCTION_GATEWAY,
  notifyUrl: "https://researchgpt.example/api/payments/alipay/notify",
  returnUrl: "https://researchgpt.example/account/points/payment-return",
}, productionSdk);
assert.equal(productionProvider.providerId, "alipay");
assert.equal(productionProvider.gateway, ALIPAY_PRODUCTION_GATEWAY);

const orderId = randomUUID();
const checkout = await provider.createCheckout({
  orderId,
  ownerId: randomUUID(),
  provider: provider.providerId,
  merchantAccountId: sellerId,
  providerOrderId: null,
  status: "pending",
  purchasedPoints: 316,
  bonusPoints: 41,
  amountMinorUnits: 316,
  currency: "CNY",
  purchasePolicyVersion: "point-purchase-v1",
  bonusCampaignVersion: "launch-bonus-v1",
  returnContextId: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  paidAt: null,
});
assert.equal(checkout.checkoutKind, "redirect");
assert.equal(checkout.providerOrderId, orderId);
assert.match(checkout.checkoutUrl, /^https:\/\/openapi-sandbox\.dl\.alipaydev\.com\/gateway\.do\?/);
assert.match(checkout.checkoutUrl, /FAST_INSTANT_TRADE_PAY/);

const productionCheckout = await productionProvider.createCheckout({
  orderId,
  ownerId: randomUUID(),
  provider: productionProvider.providerId,
  merchantAccountId: sellerId,
  providerOrderId: null,
  status: "pending",
  purchasedPoints: 316,
  bonusPoints: 41,
  amountMinorUnits: 316,
  currency: "CNY",
  purchasePolicyVersion: "point-purchase-v1",
  bonusCampaignVersion: "launch-bonus-v1",
  returnContextId: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  paidAt: null,
});
assert.equal(productionCheckout.checkoutKind, "redirect");
if (productionCheckout.checkoutKind !== "redirect") throw new Error("Expected production redirect checkout.");
assert.match(productionCheckout.checkoutUrl, /^https:\/\/openapi\.alipay\.com\/gateway\.do\?/);

const notification: Record<string, string> = {
  notify_time: "2026-08-31 20:01:02",
  notify_type: "trade_status_sync",
  notify_id: "notify-sandbox-1",
  app_id: appId,
  trade_no: "2026083122000000000001",
  out_trade_no: orderId,
  seller_id: sellerId,
  trade_status: "TRADE_SUCCESS",
  total_amount: "3.16",
  sign_type: "RSA2",
};
notification.sign = sign("RSA-SHA256", Buffer.from(signatureContent(notification), "utf8"), alipayKeys.privateKey).toString("base64");
const rawBody = new TextEncoder().encode(new URLSearchParams(notification).toString());
const event = await provider.verifyWebhook({ rawBody, headers: new Headers({ "content-type": "application/x-www-form-urlencoded" }) });
assert.equal(event.orderId, orderId);
assert.equal(event.amountMinorUnits, 316);
assert.equal(event.providerEventId, "notify-sandbox-1");
assert.equal(event.audit.tradeNo, notification.trade_no);

const queriedProvider = new AlipaySandboxPaymentProvider({
  appId, sellerId, privateKey: applicationKeys.privateKey, alipayPublicKey: alipayKeys.publicKey,
  gateway: ALIPAY_SANDBOX_GATEWAY, notifyUrl: "https://preview.example.test/notify", returnUrl: "https://preview.example.test/return",
}, {
  pageExec: sdk.pageExec.bind(sdk),
  checkNotifySignV2: sdk.checkNotifySignV2.bind(sdk),
  exec: async () => ({
    code: "10000", msg: "Success", out_trade_no: orderId,
    trade_no: notification.trade_no,
    trade_status: "TRADE_SUCCESS", total_amount: "3.16",
    send_pay_date: "2026-08-31 20:01:02",
  }),
});
const queriedEvent = await queriedProvider.querySuccessfulPayment({
  orderId, ownerId: randomUUID(), provider: provider.providerId, merchantAccountId: sellerId,
  providerOrderId: orderId, status: "pending", purchasedPoints: 316, bonusPoints: 41,
  amountMinorUnits: 316, currency: "CNY", purchasePolicyVersion: "point-purchase-v1",
  bonusCampaignVersion: "launch-bonus-v1", returnContextId: null,
  createdAt: "2026-08-31T12:00:00.000Z", paidAt: null,
});
assert.equal(queriedEvent?.providerEventId, `alipay-query:${notification.trade_no}`);
assert.equal(queriedEvent?.amountMinorUnits, 316);

const tampered = new URLSearchParams(notification);
tampered.set("total_amount", "3.17");
await assert.rejects(() => provider.verifyWebhook({ rawBody: new TextEncoder().encode(tampered.toString()), headers: new Headers() }), /signature/);

const pending: Record<string, string> = { ...notification, trade_status: "WAIT_BUYER_PAY" };
pending.sign = sign("RSA-SHA256", Buffer.from(signatureContent(pending), "utf8"), alipayKeys.privateKey).toString("base64");
await assert.rejects(() => provider.verifyWebhook({ rawBody: new TextEncoder().encode(new URLSearchParams(pending).toString()), headers: new Headers() }), /not a paid event/);

console.log("Alipay sandbox and production gateway isolation, redirect, RSA2 notification and rejection contracts passed.");
