import { createHmac, timingSafeEqual } from "node:crypto";
import { VerifiedPaymentEventSchema } from "../../domain/payment-contracts.ts";
import type { PaymentCheckout, PaymentProvider } from "../../ports/payment-provider.ts";

export class SignedTestPaymentProvider implements PaymentProvider {
  readonly providerId = "signed_test";
  readonly merchantAccountId: string;
  private readonly secret: string;

  constructor(input: { merchantAccountId: string; secret: string; runtimeEnvironment?: string }) {
    if ((input.runtimeEnvironment ?? process.env.NODE_ENV) === "production") {
      throw new Error("The signed test payment provider is forbidden in production.");
    }
    if (input.secret.length < 16) throw new Error("Test payment secret is too short.");
    this.merchantAccountId = input.merchantAccountId;
    this.secret = input.secret;
  }

  async createCheckout(order: Parameters<PaymentProvider["createCheckout"]>[0]): Promise<PaymentCheckout> {
    const providerOrderId = `test_${order.orderId}`;
    return {
      providerOrderId,
      checkoutKind: "redirect",
      checkoutUrl: `https://payments.test.invalid/checkout/${providerOrderId}`,
      expiresAt: new Date(Date.parse(order.createdAt) + 15 * 60_000).toISOString(),
    };
  }

  sign(rawBody: Uint8Array): string {
    return createHmac("sha256", this.secret).update(rawBody).digest("hex");
  }

  async verifyWebhook(input: { rawBody: Uint8Array; headers: Headers }) {
    const supplied = input.headers.get("x-test-payment-signature") ?? "";
    const expected = this.sign(input.rawBody);
    const suppliedBytes = Buffer.from(supplied, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new Error("Test payment webhook signature is invalid.");
    }
    const payload = JSON.parse(Buffer.from(input.rawBody).toString("utf8")) as Record<string, unknown>;
    const eventKind = payload.eventKind === "payment_reversed" || payload.eventKind === "chargeback"
      ? payload.eventKind
      : "payment_succeeded";
    return VerifiedPaymentEventSchema.parse({
      providerEventId: payload.providerEventId,
      provider: this.providerId,
      eventKind,
      ...(eventKind === "payment_succeeded" ? {} : {
        reversalReason: eventKind === "chargeback" ? "chargeback" : "forced_reversal",
      }),
      merchantAccountId: payload.merchantAccountId,
      providerOrderId: payload.providerOrderId,
      orderId: payload.orderId,
      amountMinorUnits: payload.amountMinorUnits,
      currency: payload.currency,
      occurredAt: payload.occurredAt,
      audit: { testEvent: true },
    });
  }

  async querySuccessfulPayment() {
    return null;
  }
}
