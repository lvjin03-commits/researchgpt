import type { PaymentRiskContext, PaymentRiskDecision, PaymentRiskPolicy } from "../domain/payment-risk.ts";

export interface PaymentRiskRepository {
  authorizeCheckout(input: {
    riskEventId: string;
    orderId: string;
    ownerId: string;
    amountMinorUnits: number;
    context: PaymentRiskContext;
    policy: PaymentRiskPolicy;
    now: string;
  }): Promise<PaymentRiskDecision>;
}
