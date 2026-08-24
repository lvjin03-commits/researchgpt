import { z } from "zod";

const UuidSchema = z.string().uuid();
const PositiveIntegerSchema = z.number().int().positive().safe();

export const POINT_PURCHASE_POLICY_VERSION = "point-purchase-v1" as const;
export const LAUNCH_BONUS_CAMPAIGN_VERSION = "launch-bonus-v1" as const;
export const POINT_PAYMENT_CURRENCY = "CNY" as const;

export const PointPaymentOrderSchema = z.object({
  orderId: UuidSchema,
  ownerId: UuidSchema,
  provider: z.string().trim().min(1).max(50),
  merchantAccountId: z.string().trim().min(1).max(200),
  providerOrderId: z.string().trim().min(1).max(200).nullable(),
  status: z.enum(["pending", "paid", "failed", "closed", "reversed"]),
  purchasedPoints: PositiveIntegerSchema,
  bonusPoints: z.number().int().nonnegative().safe(),
  amountMinorUnits: PositiveIntegerSchema,
  currency: z.literal(POINT_PAYMENT_CURRENCY),
  purchasePolicyVersion: z.literal(POINT_PURCHASE_POLICY_VERSION),
  bonusCampaignVersion: z.literal(LAUNCH_BONUS_CAMPAIGN_VERSION),
  returnContextId: UuidSchema.nullable(),
  createdAt: z.string().datetime({ offset: true }),
  paidAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type PointPaymentOrder = z.infer<typeof PointPaymentOrderSchema>;

export const PointPaymentOrderPageSchema = z.object({
  orders: z.array(PointPaymentOrderSchema),
  nextCursor: z.string().min(1).nullable(),
}).strict();
export type PointPaymentOrderPage = z.infer<typeof PointPaymentOrderPageSchema>;

const VerifiedPaymentEventBaseSchema = z.object({
  providerEventId: z.string().trim().min(1).max(200),
  provider: z.string().trim().min(1).max(50),
  merchantAccountId: z.string().trim().min(1).max(200),
  providerOrderId: z.string().trim().min(1).max(200),
  orderId: UuidSchema,
  amountMinorUnits: PositiveIntegerSchema,
  currency: z.literal(POINT_PAYMENT_CURRENCY),
  occurredAt: z.string().datetime({ offset: true }),
  audit: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export const VerifiedPaymentEventSchema = z.discriminatedUnion("eventKind", [
  VerifiedPaymentEventBaseSchema.extend({ eventKind: z.literal("payment_succeeded") }).strict(),
  VerifiedPaymentEventBaseSchema.extend({
    eventKind: z.enum(["payment_reversed", "chargeback"]),
    reversalReason: z.enum(["forced_reversal", "chargeback"]),
  }).strict(),
]);
export type VerifiedPaymentEvent = z.infer<typeof VerifiedPaymentEventSchema>;
export type VerifiedSuccessfulPaymentEvent = Extract<VerifiedPaymentEvent, { eventKind: "payment_succeeded" }>;
export type VerifiedReversalPaymentEvent = Exclude<VerifiedPaymentEvent, { eventKind: "payment_succeeded" }>;

export type PointPurchasePolicy = {
  minimumPoints: number;
  maximumPoints: number;
};

export function createPointPurchaseQuote(input: {
  requestedPoints: number;
  policy: PointPurchasePolicy;
}) {
  const purchasedPoints = PositiveIntegerSchema.parse(input.requestedPoints);
  if (!Number.isSafeInteger(input.policy.minimumPoints) || input.policy.minimumPoints <= 0 ||
      !Number.isSafeInteger(input.policy.maximumPoints) || input.policy.maximumPoints < input.policy.minimumPoints) {
    throw new Error("Point purchase limits are invalid.");
  }
  if (purchasedPoints < input.policy.minimumPoints || purchasedPoints > input.policy.maximumPoints) {
    throw new RangeError("Requested points are outside the configured purchase limits.");
  }
  return Object.freeze({
    purchasedPoints,
    bonusPoints: Math.floor(purchasedPoints * 1_300 / 10_000),
    amountMinorUnits: purchasedPoints,
    currency: POINT_PAYMENT_CURRENCY,
    purchasePolicyVersion: POINT_PURCHASE_POLICY_VERSION,
    bonusCampaignVersion: LAUNCH_BONUS_CAMPAIGN_VERSION,
  });
}
