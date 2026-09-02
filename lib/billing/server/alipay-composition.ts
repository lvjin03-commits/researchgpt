import "server-only";

import { PointPaymentService } from "../application/payment-service.ts";
import { AlipayPaymentProvider, ALIPAY_PRODUCTION_GATEWAY, ALIPAY_SANDBOX_GATEWAY,
  type AlipayPaymentMode } from "../infrastructure/alipay/alipay-payment-provider.ts";
import { SupabasePaymentRepository } from "../infrastructure/supabase/supabase-payment-repository.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.replace(/\\n/g, "\n").trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function alipayPaymentMode(): AlipayPaymentMode {
  const mode = requiredEnvironment("ALIPAY_PAYMENT_MODE");
  if (mode !== "sandbox" && mode !== "production") throw new Error("Invalid ALIPAY_PAYMENT_MODE.");
  return mode;
}

function publicHttpsUrl(name: string) {
  const value = requiredEnvironment(name);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must be an HTTPS URL.`);
  return url.toString();
}

function sandboxCallbackUrl(pathname: string, setBypassCookie = false) {
  const explicitName = setBypassCookie ? "ALIPAY_RETURN_URL" : "ALIPAY_NOTIFY_URL";
  const explicit = process.env[explicitName]?.trim();
  if (explicit) return explicit;
  const deploymentHost = requiredEnvironment("VERCEL_URL");
  const bypassSecret = requiredEnvironment("VERCEL_AUTOMATION_BYPASS_SECRET");
  const url = new URL(`https://${deploymentHost}${pathname}`);
  url.searchParams.set("x-vercel-protection-bypass", bypassSecret);
  if (setBypassCookie) url.searchParams.set("x-vercel-set-bypass-cookie", "true");
  return url.toString();
}

export function createAlipayPaymentProvider() {
  const mode = alipayPaymentMode();
  const production = mode === "production";
  return new AlipayPaymentProvider({
    mode,
    appId: requiredEnvironment("ALIPAY_APP_ID"), privateKey: requiredEnvironment("ALIPAY_PRIVATE_KEY"),
    alipayPublicKey: requiredEnvironment("ALIPAY_PUBLIC_KEY"), sellerId: requiredEnvironment("ALIPAY_SELLER_ID"),
    gateway: requiredEnvironment("ALIPAY_GATEWAY_URL"),
    notifyUrl: production ? publicHttpsUrl("ALIPAY_NOTIFY_URL") : sandboxCallbackUrl("/api/payments/alipay/notify"),
    returnUrl: production ? publicHttpsUrl("ALIPAY_RETURN_URL") : sandboxCallbackUrl("/account/points/payment-return", true),
  });
}

export function createAlipayPaymentService(client: SupabaseClient) {
  return new PointPaymentService(new SupabasePaymentRepository(client), createAlipayPaymentProvider(),
    { minimumPoints: 1, maximumPoints: 100_000 });
}

export function alipayCheckoutOrigin() {
  const gateway = alipayPaymentMode() === "production" ? ALIPAY_PRODUCTION_GATEWAY : ALIPAY_SANDBOX_GATEWAY;
  return new URL(gateway).origin;
}
