import { z } from "zod";

export const PointGrantKindSchema = z.enum([
  "purchased",
  "purchase_bonus",
  "promotional_trial",
]);
export type PointGrantKind = z.infer<typeof PointGrantKindSchema>;

export const PointAccountStatusSchema = z.enum(["active", "risk_hold"]);
export type PointAccountStatus = z.infer<typeof PointAccountStatusSchema>;

const PointAmountSchema = z.number().int().nonnegative().safe();
const PositivePointAmountSchema = PointAmountSchema.refine((value) => value > 0, {
  message: "points must be positive",
});

export const PointAccountSchema = z.object({
  accountId: z.string().uuid(),
  ownerId: z.string().uuid(),
  status: PointAccountStatusSchema,
  availablePoints: PointAmountSchema,
  reservedPoints: PointAmountSchema,
  lifetimeSpentPoints: PointAmountSchema,
  version: PointAmountSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PointAccount = z.infer<typeof PointAccountSchema>;

export const PointLotSchema = z.object({
  lotId: z.string().uuid(),
  accountId: z.string().uuid(),
  grantKind: PointGrantKindSchema,
  pointsGranted: PositivePointAmountSchema,
  pointsRemaining: PointAmountSchema,
  paymentOrderId: z.string().min(1).nullable(),
  campaignId: z.string().min(1).nullable(),
  grantReason: z.string().min(1),
  policyVersion: z.string().min(1),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type PointLot = z.infer<typeof PointLotSchema>;

export const PointReservationSchema = z.object({
  reservationId: z.string().uuid(),
  accountId: z.string().uuid(),
  billingOperationId: z.string().uuid(),
  requestedPoints: PositivePointAmountSchema,
  reservedPoints: PositivePointAmountSchema,
  settledPoints: PointAmountSchema,
  releasedPoints: PointAmountSchema,
  status: z.enum(["reserved", "settled", "released"]),
  pricePolicyVersion: z.string().min(1),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  finalizedAt: z.string().datetime().nullable(),
});
export type PointReservation = z.infer<typeof PointReservationSchema>;

export const PointTransactionKindSchema = z.enum([
  "grant",
  "reserve",
  "settle",
  "release",
  "reversal",
]);
export type PointTransactionKind = z.infer<typeof PointTransactionKindSchema>;

export const PointTransactionSchema = z.object({
  transactionId: z.string().uuid(),
  accountId: z.string().uuid(),
  eventId: z.string().uuid(),
  kind: PointTransactionKindSchema,
  lotId: z.string().uuid().nullable(),
  reservationId: z.string().uuid().nullable(),
  availableDelta: z.number().int().safe(),
  reservedDelta: z.number().int().safe(),
  spentDelta: z.number().int().safe(),
  reason: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type PointTransaction = z.infer<typeof PointTransactionSchema>;

export const PointRecoveryShortfallSchema = z.object({
  shortfallId: z.string().uuid(),
  accountId: z.string().uuid(),
  lotId: z.string().uuid(),
  eventId: z.string().uuid(),
  expectedPoints: PositivePointAmountSchema,
  recoveredPoints: PointAmountSchema,
  shortfallPoints: PositivePointAmountSchema,
  reason: z.enum(["chargeback", "forced_reversal", "duplicate_payment"]),
  status: z.enum(["open", "waived", "recovered"]),
  createdAt: z.string().datetime(),
});
export type PointRecoveryShortfall = z.infer<typeof PointRecoveryShortfallSchema>;

export type PointAccountSnapshot = {
  account: PointAccount;
  lots: PointLot[];
};

export type GrantPointLotInput = {
  ownerId: string;
  eventId: string;
  lotId: string;
  grantKind: PointGrantKind;
  points: number;
  paymentOrderId: string | null;
  campaignId: string | null;
  grantReason: string;
  policyVersion: string;
  expiresAt: string | null;
  now: string;
};

export type ReservePointsInput = {
  ownerId: string;
  reservationId: string;
  billingOperationId: string;
  points: number;
  pricePolicyVersion: string;
  expiresAt: string;
  now: string;
};

export type ReservePointBundleSetInput = {
  ownerId: string;
  parentBillingOperationId: string;
  bundles: Array<Omit<ReservePointsInput, "ownerId">>;
};

export type FinalizeReservationInput = {
  ownerId: string;
  eventId: string;
  reservationId: string;
  settledPoints: number;
  reason: string;
  now: string;
};

export type ReleaseReservationInput = {
  ownerId: string;
  eventId: string;
  reservationId: string;
  reason: string;
  now: string;
};

export type ReversePointLotInput = {
  ownerId: string;
  eventId: string;
  lotId: string;
  points: number;
  reason: "chargeback" | "forced_reversal" | "duplicate_payment";
  now: string;
};

export type ReversePointLotResult = {
  recoveredPoints: number;
  shortfallPoints: number;
  account: PointAccount;
};

export class InsufficientPointsError extends Error {
  readonly code = "insufficient_points";
  readonly availablePoints: number;
  readonly requestedPoints: number;

  constructor(availablePoints: number, requestedPoints: number) {
    super(`Insufficient points: ${availablePoints} available, ${requestedPoints} requested.`);
    this.availablePoints = availablePoints;
    this.requestedPoints = requestedPoints;
  }
}

export class PointAccountOnHoldError extends Error {
  readonly code = "point_account_on_hold";

  constructor() {
    super("The point account is on risk hold.");
  }
}

export class PointLedgerConflictError extends Error {
  readonly code = "point_ledger_conflict";
}
