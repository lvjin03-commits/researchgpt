import "server-only";

import { PointPaymentService } from "../application/payment-service.ts";
import { AlipaySandboxPaymentProvider } from "../infrastructure/alipay/alipay-sandbox-payment-provider.ts";
import { SupabasePaymentRepository } from "../infrastructure/supabase/supabase-payment-repository.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.replace(/\\n/g, "\n").trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export function createAlipaySandboxPaymentProvider() {
  if (process.env.ALIPAY_PAYMENT_MODE !== "sandbox") {
    throw new Error("Alipay sandbox checkout is disabled.");
  }
  return new AlipaySandboxPaymentProvider({
    appId: requiredEnvironment("ALIPAY_APP_ID"),
    privateKey: requiredEnvironment("ALIPAY_PRIVATE_KEY"),
    alipayPublicKey: requiredEnvironment("ALIPAY_PUBLIC_KEY"),
    sellerId: requiredEnvironment("ALIPAY_SELLER_ID"),
    gateway: requiredEnvironment("ALIPAY_GATEWAY_URL"),
    notifyUrl: requiredEnvironment("ALIPAY_NOTIFY_URL"),
    returnUrl: requiredEnvironment("ALIPAY_RETURN_URL"),
  });
}

export function createAlipaySandboxPaymentService(client: SupabaseClient) {
  return new PointPaymentService(
    new SupabasePaymentRepository(client),
    createAlipaySandboxPaymentProvider(),
    { minimumPoints: 1, maximumPoints: 100_000 },
  );
}
