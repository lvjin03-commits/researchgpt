import type { InternalPaymentReconciliationRecord, ReconciliationFinding } from "../domain/reconciliation.ts";

export interface ReconciliationRepository {
  listInternalOrders(input: { provider: string; merchantAccountId: string; from: string; to: string }): Promise<InternalPaymentReconciliationRecord[]>;
  inspectInternalInvariants(): Promise<ReconciliationFinding[]>;
}
