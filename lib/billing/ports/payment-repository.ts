import type { PointAccountSnapshot } from "../domain/contracts.ts";
import type { PointPaymentOrder, VerifiedReversalPaymentEvent, VerifiedSuccessfulPaymentEvent } from "../domain/payment-contracts.ts";

export interface PaymentRepository {
  createPendingOrder(order: PointPaymentOrder): Promise<PointPaymentOrder>;
  attachProviderOrder(input: { orderId: string; ownerId: string; providerOrderId: string }): Promise<PointPaymentOrder>;
  getOrderForOwner(orderId: string, ownerId: string): Promise<PointPaymentOrder | null>;
  confirmSuccessfulPayment(input: {
    event: VerifiedSuccessfulPaymentEvent;
    purchasedLotId: string;
    bonusLotId: string | null;
    purchasedGrantEventId: string;
    bonusGrantEventId: string | null;
    now: string;
  }): Promise<{ order: PointPaymentOrder; account: PointAccountSnapshot }>;
  reversePayment(input: {
    event: VerifiedReversalPaymentEvent;
    purchasedReversalEventId: string;
    bonusReversalEventId: string;
    now: string;
  }): Promise<{
    order: PointPaymentOrder;
    account: PointAccountSnapshot;
    recoveredPoints: number;
    shortfallPoints: number;
  }>;
}
