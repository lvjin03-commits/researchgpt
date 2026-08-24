import { randomUUID } from "node:crypto";
import { PointPaymentOrderSchema, VerifiedPaymentEventSchema, createPointPurchaseQuote, type PointPurchasePolicy } from "../domain/payment-contracts.ts";
import type { PaymentProvider } from "../ports/payment-provider.ts";
import type { PaymentRepository } from "../ports/payment-repository.ts";
import type { PaymentRiskContext } from "../domain/payment-risk.ts";
import type { PaymentRiskService } from "./payment-risk-service.ts";

export class PointPaymentService {
  private readonly repository: PaymentRepository;
  private readonly provider: PaymentProvider;
  private readonly purchasePolicy: PointPurchasePolicy;
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly riskService?: PaymentRiskService;

  constructor(
    repository: PaymentRepository,
    provider: PaymentProvider,
    purchasePolicy: PointPurchasePolicy,
    createId: () => string = randomUUID,
    now: () => string = () => new Date().toISOString(),
    riskService?: PaymentRiskService,
  ) {
    this.repository = repository;
    this.provider = provider;
    this.purchasePolicy = purchasePolicy;
    this.createId = createId;
    this.now = now;
    this.riskService = riskService;
  }

  async createCheckout(input: { ownerId: string; requestedPoints: number; returnContextId?: string; riskContext?: PaymentRiskContext }) {
    const quote = createPointPurchaseQuote({ requestedPoints: input.requestedPoints, policy: this.purchasePolicy });
    const order = PointPaymentOrderSchema.parse({
      orderId: this.createId(), ownerId: input.ownerId,
      provider: this.provider.providerId, merchantAccountId: this.provider.merchantAccountId,
      providerOrderId: null, status: "pending", ...quote,
      returnContextId: input.returnContextId ?? null,
      createdAt: this.now(), paidAt: null,
    });
    if (this.riskService) {
      if (!input.riskContext) throw new Error("Payment risk context is required.");
      await this.riskService.authorize({
        orderId: order.orderId, ownerId: order.ownerId,
        amountMinorUnits: order.amountMinorUnits, context: input.riskContext,
      });
    }
    await this.repository.createPendingOrder(order);
    const checkout = await this.provider.createCheckout(order);
    const attached = await this.repository.attachProviderOrder({
      orderId: order.orderId, ownerId: order.ownerId, providerOrderId: checkout.providerOrderId,
    });
    return { order: attached, checkout };
  }

  async confirmWebhook(input: { rawBody: Uint8Array; headers: Headers }) {
    const event = VerifiedPaymentEventSchema.parse(await this.provider.verifyWebhook(input));
    if (event.provider !== this.provider.providerId || event.merchantAccountId !== this.provider.merchantAccountId) {
      throw new Error("Verified payment event does not match the configured provider and merchant.");
    }
    if (event.eventKind === "payment_succeeded") {
      return this.repository.confirmSuccessfulPayment({
        event,
        purchasedLotId: this.createId(),
        bonusLotId: this.createId(),
        purchasedGrantEventId: this.createId(),
        bonusGrantEventId: this.createId(),
        now: this.now(),
      });
    }
    return this.repository.reversePayment({
      event,
      purchasedReversalEventId: this.createId(),
      bonusReversalEventId: this.createId(),
      now: this.now(),
    });
  }
}
