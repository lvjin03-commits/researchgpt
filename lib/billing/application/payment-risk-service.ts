import { randomUUID } from "node:crypto";
import { PaymentRiskContextSchema, PaymentRiskDeniedError, PaymentRiskPolicySchema, type PaymentRiskContext, type PaymentRiskPolicy } from "../domain/payment-risk.ts";
import type { PaymentRiskRepository } from "../ports/payment-risk-repository.ts";

export class PaymentRiskService {
  private readonly repository: PaymentRiskRepository;
  private readonly policy: PaymentRiskPolicy;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    repository: PaymentRiskRepository,
    policy: PaymentRiskPolicy,
    createId: () => string = randomUUID,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.repository = repository;
    this.policy = PaymentRiskPolicySchema.parse(policy);
    this.createId = createId;
    this.now = now;
  }

  async authorize(input: { orderId: string; ownerId: string; amountMinorUnits: number; context: PaymentRiskContext }) {
    const decision = await this.repository.authorizeCheckout({
      riskEventId: this.createId(), orderId: input.orderId, ownerId: input.ownerId,
      amountMinorUnits: input.amountMinorUnits,
      context: PaymentRiskContextSchema.parse(input.context), policy: this.policy, now: this.now(),
    });
    if (decision.decision === "deny") throw new PaymentRiskDeniedError(decision.reason);
    return decision;
  }
}
