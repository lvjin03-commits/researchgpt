import type { SupabaseClient } from "@supabase/supabase-js";
import { ReconciliationFindingSchema, type InternalPaymentReconciliationRecord } from "../../domain/reconciliation.ts";
import type { ReconciliationRepository } from "../../ports/reconciliation-repository.ts";

export class SupabaseReconciliationRepository implements ReconciliationRepository {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }

  async listInternalOrders(input: Parameters<ReconciliationRepository["listInternalOrders"]>[0]) {
    const { data, error } = await this.client.rpc("list_payment_orders_for_reconciliation", {
      p_provider: input.provider, p_merchant_account_id: input.merchantAccountId,
      p_from: input.from, p_to: input.to,
    });
    if (error) throw new Error(`list_payment_orders_for_reconciliation failed: ${error.message}`);
    return (data as Array<Record<string, unknown>>).map((row): InternalPaymentReconciliationRecord => ({
      orderId: String(row.orderId), provider: String(row.provider), merchantAccountId: String(row.merchantAccountId),
      providerOrderId: String(row.providerOrderId), status: row.status as InternalPaymentReconciliationRecord["status"],
      amountMinorUnits: Number(row.amountMinorUnits), currency: String(row.currency),
    }));
  }

  async inspectInternalInvariants() {
    const { data, error } = await this.client.rpc("inspect_point_billing_invariants");
    if (error) throw new Error(`inspect_point_billing_invariants failed: ${error.message}`);
    return (data as unknown[]).map((finding) => ReconciliationFindingSchema.parse(finding));
  }
}
