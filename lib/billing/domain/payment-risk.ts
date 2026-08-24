import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const PaymentRiskContextSchema = z.object({
  deviceHash: Sha256Schema,
  networkHash: Sha256Schema,
  paymentMethodHash: Sha256Schema.nullable(),
}).strict();
export type PaymentRiskContext = z.infer<typeof PaymentRiskContextSchema>;

export const PaymentRiskPolicySchema = z.object({
  policyVersion: z.string().trim().min(1).max(100),
  maximumSinglePurchaseMinorUnits: z.number().int().positive().safe(),
  maximumAccountDailyMinorUnits: z.number().int().positive().safe(),
  maximumDeviceDailyMinorUnits: z.number().int().positive().safe(),
  maximumNetworkHourlyOrders: z.number().int().positive().safe(),
  maximumPaymentMethodDailyAccounts: z.number().int().positive().safe(),
}).strict();
export type PaymentRiskPolicy = z.infer<typeof PaymentRiskPolicySchema>;

export const PaymentRiskDecisionSchema = z.object({
  riskEventId: z.string().uuid(),
  decision: z.enum(["allow", "deny"]),
  reason: z.enum([
    "within_limits", "single_purchase_limit", "account_daily_limit",
    "device_daily_limit", "network_velocity_limit", "payment_method_account_limit",
  ]),
  policyVersion: z.string().trim().min(1).max(100),
}).strict();
export type PaymentRiskDecision = z.infer<typeof PaymentRiskDecisionSchema>;

export class PaymentRiskDeniedError extends Error {
  readonly code = "payment_risk_denied";
  readonly reason: PaymentRiskDecision["reason"];
  constructor(reason: PaymentRiskDecision["reason"]) {
    super(`Payment checkout was denied by risk policy: ${reason}.`);
    this.reason = reason;
  }
}
