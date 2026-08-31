import type { PointPaymentOrder, VerifiedPaymentEvent } from "../domain/payment-contracts.ts";

type PaymentCheckoutBase = {
  providerOrderId: string;
  expiresAt: string;
};

export type PaymentCheckout = PaymentCheckoutBase & ({
  checkoutKind: "qr_code" | "redirect";
  checkoutUrl: string;
} | {
  checkoutKind: "html_form";
  checkoutHtml: string;
});

export interface PaymentProvider {
  readonly providerId: string;
  readonly merchantAccountId: string;
  createCheckout(order: PointPaymentOrder): Promise<PaymentCheckout>;
  verifyWebhook(input: { rawBody: Uint8Array; headers: Headers }): Promise<VerifiedPaymentEvent>;
}
