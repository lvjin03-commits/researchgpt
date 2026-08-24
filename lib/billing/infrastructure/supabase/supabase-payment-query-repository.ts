import type { SupabaseClient } from "@supabase/supabase-js";
import { PointPaymentOrderPageSchema } from "../../domain/payment-contracts.ts";
import type { PaymentQueryRepository } from "../../ports/payment-query-repository.ts";
import { orderFromJson } from "./supabase-payment-repository.ts";

export class SupabasePaymentQueryRepository implements PaymentQueryRepository {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }

  async listOrders(input: Parameters<PaymentQueryRepository["listOrders"]>[0]) {
    const { data, error } = await this.client.rpc("point_payment_orders_for_owner", {
      p_owner_id: input.ownerId,
      p_cursor: input.cursor,
      p_limit: input.limit,
      p_status: input.status,
    });
    if (error) throw new Error(`point_payment_orders_for_owner failed: ${error.message}`);
    const value = data as { orders?: Array<Record<string, unknown>>; nextCursor?: string | null };
    return PointPaymentOrderPageSchema.parse({
      orders: (value.orders ?? []).map(orderFromJson),
      nextCursor: value.nextCursor ?? null,
    });
  }
}
