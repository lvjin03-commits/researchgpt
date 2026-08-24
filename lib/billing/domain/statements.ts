import { z } from "zod";

export const PointStatementEntrySchema = z.object({
  transactionId: z.string().uuid(),
  occurredAt: z.string().datetime({ offset: true }),
  kind: z.enum(["grant", "reserve", "settle", "release", "reversal"]),
  availableDelta: z.number().int().safe(),
  reservedDelta: z.number().int().safe(),
  spentDelta: z.number().int().safe(),
  operation: z.string().nullable(),
  billingOperationId: z.string().uuid().nullable(),
  pricePolicyVersion: z.string().nullable(),
  paymentOrderId: z.string().nullable(),
  grantKind: z.enum(["purchased", "purchase_bonus", "promotional_trial"]).nullable(),
  reason: z.string().min(1),
}).strict();
export type PointStatementEntry = z.infer<typeof PointStatementEntrySchema>;

export const PointStatementSchema = z.object({
  availablePoints: z.number().int().nonnegative().safe(),
  reservedPoints: z.number().int().nonnegative().safe(),
  lifetimeSpentPoints: z.number().int().nonnegative().safe(),
  entries: z.array(PointStatementEntrySchema),
  nextCursor: z.string().min(1).nullable(),
}).strict();
export type PointStatement = z.infer<typeof PointStatementSchema>;
