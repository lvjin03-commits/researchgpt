import { z } from "zod";

export const ProviderSettlementRecordSchema = z.object({
  provider: z.string().trim().min(1),
  merchantAccountId: z.string().trim().min(1),
  providerOrderId: z.string().trim().min(1),
  status: z.enum(["paid", "reversed", "chargeback"]),
  amountMinorUnits: z.number().int().positive().safe(),
  currency: z.string().trim().min(3).max(3),
  settledAt: z.string().datetime({ offset: true }),
}).strict();
export type ProviderSettlementRecord = z.infer<typeof ProviderSettlementRecordSchema>;

export const ReconciliationFindingSchema = z.object({
  code: z.enum([
    "missing_internal_order", "missing_provider_settlement", "provider_amount_mismatch", "provider_status_mismatch",
    "missing_payment_event", "missing_purchased_lot", "point_grant_mismatch",
    "account_available_mismatch", "account_reserved_mismatch",
  ]),
  providerOrderId: z.string().nullable(),
  orderId: z.string().uuid().nullable(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict();
export type ReconciliationFinding = z.infer<typeof ReconciliationFindingSchema>;

export type InternalPaymentReconciliationRecord = {
  orderId: string;
  provider: string;
  merchantAccountId: string;
  providerOrderId: string;
  status: "pending" | "paid" | "failed" | "closed" | "reversed";
  amountMinorUnits: number;
  currency: string;
};

export function reconcileProviderSettlements(input: {
  providerRecords: ProviderSettlementRecord[];
  internalOrders: InternalPaymentReconciliationRecord[];
}): ReconciliationFinding[] {
  const internal = new Map(input.internalOrders.map((order) => [`${order.provider}:${order.merchantAccountId}:${order.providerOrderId}`, order]));
  const findings: ReconciliationFinding[] = [];
  for (const raw of input.providerRecords) {
    const row = ProviderSettlementRecordSchema.parse(raw);
    const order = internal.get(`${row.provider}:${row.merchantAccountId}:${row.providerOrderId}`);
    if (!order) {
      findings.push({ code: "missing_internal_order", providerOrderId: row.providerOrderId, orderId: null, details: { providerStatus: row.status } });
      continue;
    }
    if (order.amountMinorUnits !== row.amountMinorUnits || order.currency !== row.currency) {
      findings.push({ code: "provider_amount_mismatch", providerOrderId: row.providerOrderId, orderId: order.orderId, details: { providerAmount: row.amountMinorUnits, internalAmount: order.amountMinorUnits, providerCurrency: row.currency, internalCurrency: order.currency } });
    }
    const expectedInternal = row.status === "paid" ? "paid" : "reversed";
    if (order.status !== expectedInternal) {
      findings.push({ code: "provider_status_mismatch", providerOrderId: row.providerOrderId, orderId: order.orderId, details: { providerStatus: row.status, internalStatus: order.status } });
    }
  }
  const providerKeys = new Set(input.providerRecords.map((row) => `${row.provider}:${row.merchantAccountId}:${row.providerOrderId}`));
  for (const order of input.internalOrders) {
    const key = `${order.provider}:${order.merchantAccountId}:${order.providerOrderId}`;
    if ((order.status === "paid" || order.status === "reversed") && !providerKeys.has(key)) {
      findings.push({
        code: "missing_provider_settlement", providerOrderId: order.providerOrderId,
        orderId: order.orderId, details: { internalStatus: order.status },
      });
    }
  }
  return findings.map((finding) => ReconciliationFindingSchema.parse(finding));
}
