import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PaymentRiskService } from "../lib/billing/application/payment-risk-service.ts";
import { PaymentRiskDeniedError, type PaymentRiskDecision } from "../lib/billing/domain/payment-risk.ts";
import type { PaymentRiskRepository } from "../lib/billing/ports/payment-risk-repository.ts";

class FixedRiskRepository implements PaymentRiskRepository {
  private readonly decision: PaymentRiskDecision;
  constructor(decision: PaymentRiskDecision) { this.decision = decision; }
  async authorizeCheckout() { return this.decision; }
}

const hash = "a".repeat(64);
const policy = {
  policyVersion: "payment-risk-v1",
  maximumSinglePurchaseMinorUnits: 100_000,
  maximumAccountDailyMinorUnits: 200_000,
  maximumDeviceDailyMinorUnits: 300_000,
  maximumNetworkHourlyOrders: 10,
  maximumPaymentMethodDailyAccounts: 3,
};
const allow = new PaymentRiskService(new FixedRiskRepository({
  riskEventId: randomUUID(), decision: "allow", reason: "within_limits", policyVersion: "payment-risk-v1",
}), policy);
await allow.authorize({ orderId: randomUUID(), ownerId: randomUUID(), amountMinorUnits: 316, context: { deviceHash: hash, networkHash: hash, paymentMethodHash: null } });

const deny = new PaymentRiskService(new FixedRiskRepository({
  riskEventId: randomUUID(), decision: "deny", reason: "network_velocity_limit", policyVersion: "payment-risk-v1",
}), policy);
await assert.rejects(
  () => deny.authorize({ orderId: randomUUID(), ownerId: randomUUID(), amountMinorUnits: 316, context: { deviceHash: hash, networkHash: hash, paymentMethodHash: null } }),
  PaymentRiskDeniedError,
);
await assert.rejects(() => allow.authorize({
  orderId: randomUUID(), ownerId: randomUUID(), amountMinorUnits: 316,
  context: { deviceHash: "raw-ip-is-forbidden", networkHash: hash, paymentMethodHash: null },
}));
console.log("Payment risk policy, deterministic denial and hashed-context contracts passed.");
