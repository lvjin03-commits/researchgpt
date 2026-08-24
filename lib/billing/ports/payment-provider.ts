import type { PointPaymentOrder, VerifiedPaymentEvent } from "../domain/payment-contracts.ts";

export type PaymentCheckout = {
  providerOrderId: string;
  checkoutKind: "qr_code" | "redirect";
  checkoutUrl: string;
  expiresAt: string;
};

export interface PaymentProvider {
  readonly providerId: string;
  readonly merchantAccountId: string;
  createCheckout(order: PointPaymentOrder): Promise<PaymentCheckout>;
  verifyWebhook(input: { rawBody: Uint8Array; headers: Headers }): Promise<VerifiedPaymentEvent>;
}
