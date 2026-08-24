import type { SupabaseClient } from "@supabase/supabase-js";
import { PaymentRiskDecisionSchema } from "../../domain/payment-risk.ts";
import type { PaymentRiskRepository } from "../../ports/payment-risk-repository.ts";

export class SupabasePaymentRiskRepository implements PaymentRiskRepository {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }

  async authorizeCheckout(input: Parameters<PaymentRiskRepository["authorizeCheckout"]>[0]) {
    const { data, error } = await this.client.rpc("authorize_point_payment_checkout", {
      p_risk_event_id: input.riskEventId, p_order_id: input.orderId,
      p_owner_id: input.ownerId, p_amount_minor_units: input.amountMinorUnits,
      p_device_hash: input.context.deviceHash, p_network_hash: input.context.networkHash,
      p_payment_method_hash: input.context.paymentMethodHash,
      p_policy: input.policy, p_now: input.now,
    });
    if (error) throw new Error(`authorize_point_payment_checkout failed: ${error.message}`);
    return PaymentRiskDecisionSchema.parse(data);
  }
}
