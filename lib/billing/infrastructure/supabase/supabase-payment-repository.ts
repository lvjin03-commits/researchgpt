import type { SupabaseClient } from "@supabase/supabase-js";
import { PointAccountSchema, PointLotSchema, type PointAccountSnapshot } from "../../domain/contracts.ts";
import { PointPaymentOrderSchema, type PointPaymentOrder } from "../../domain/payment-contracts.ts";
import type { PaymentRepository } from "../../ports/payment-repository.ts";

export function orderFromJson(value: Record<string, unknown>): PointPaymentOrder {
  return PointPaymentOrderSchema.parse({
    orderId: value.orderId ?? value.order_id,
    ownerId: value.ownerId ?? value.owner_id,
    provider: value.provider,
    merchantAccountId: value.merchantAccountId ?? value.merchant_account_id,
    providerOrderId: value.providerOrderId ?? value.provider_order_id ?? null,
    status: value.status,
    purchasedPoints: Number(value.purchasedPoints ?? value.purchased_points),
    bonusPoints: Number(value.bonusPoints ?? value.bonus_points),
    amountMinorUnits: Number(value.amountMinorUnits ?? value.amount_minor_units),
    currency: value.currency,
    purchasePolicyVersion: value.purchasePolicyVersion ?? value.purchase_policy_version,
    bonusCampaignVersion: value.bonusCampaignVersion ?? value.bonus_campaign_version,
    returnContextId: value.returnContextId ?? value.return_context_id ?? null,
    createdAt: value.createdAt ?? value.created_at,
    paidAt: value.paidAt ?? value.paid_at ?? null,
  });
}

function accountFromJson(value: unknown): PointAccountSnapshot {
  const source = value as { account: Record<string, unknown>; lots: Array<Record<string, unknown>> };
  return {
    account: PointAccountSchema.parse({
      ...source.account,
      availablePoints: Number(source.account.availablePoints),
      reservedPoints: Number(source.account.reservedPoints),
      lifetimeSpentPoints: Number(source.account.lifetimeSpentPoints),
      version: Number(source.account.version),
    }),
    lots: source.lots.map((lot) => PointLotSchema.parse({
      ...lot,
      pointsGranted: Number(lot.pointsGranted),
      pointsRemaining: Number(lot.pointsRemaining),
    })),
  };
}

function assertRpc(name: string, error: { message: string } | null) {
  if (error) throw new Error(`${name} failed: ${error.message}`);
}

export class SupabasePaymentRepository implements PaymentRepository {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }

  async createPendingOrder(order: PointPaymentOrder) {
    const { data, error } = await this.client.rpc("create_point_payment_order", {
      p_order: order,
    });
    assertRpc("create_point_payment_order", error);
    return orderFromJson(data as Record<string, unknown>);
  }

  async attachProviderOrder(input: { orderId: string; ownerId: string; providerOrderId: string }) {
    const { data, error } = await this.client.rpc("attach_point_provider_order", {
      p_order_id: input.orderId, p_owner_id: input.ownerId,
      p_provider_order_id: input.providerOrderId,
    });
    assertRpc("attach_point_provider_order", error);
    return orderFromJson(data as Record<string, unknown>);
  }

  async getOrderForOwner(orderId: string, ownerId: string) {
    const { data, error } = await this.client.rpc("point_payment_order_for_owner", {
      p_order_id: orderId, p_owner_id: ownerId,
    });
    assertRpc("point_payment_order_for_owner", error);
    return data ? orderFromJson(data as Record<string, unknown>) : null;
  }

  async confirmSuccessfulPayment(input: Parameters<PaymentRepository["confirmSuccessfulPayment"]>[0]) {
    const { event } = input;
    const { data, error } = await this.client.rpc("confirm_point_payment", {
      p_provider_event_id: event.providerEventId,
      p_provider: event.provider,
      p_merchant_account_id: event.merchantAccountId,
      p_provider_order_id: event.providerOrderId,
      p_order_id: event.orderId,
      p_amount_minor_units: event.amountMinorUnits,
      p_currency: event.currency,
      p_occurred_at: event.occurredAt,
      p_audit: event.audit,
      p_purchased_lot_id: input.purchasedLotId,
      p_bonus_lot_id: input.bonusLotId,
      p_purchased_grant_event_id: input.purchasedGrantEventId,
      p_bonus_grant_event_id: input.bonusGrantEventId,
      p_now: input.now,
    });
    assertRpc("confirm_point_payment", error);
    const result = data as { order: Record<string, unknown>; account: unknown };
    return { order: orderFromJson(result.order), account: accountFromJson(result.account) };
  }

  async reversePayment(input: Parameters<PaymentRepository["reversePayment"]>[0]) {
    const { event } = input;
    const { data, error } = await this.client.rpc("reverse_point_payment", {
      p_provider_event_id: event.providerEventId,
      p_provider: event.provider,
      p_event_kind: event.eventKind,
      p_reversal_reason: event.reversalReason,
      p_merchant_account_id: event.merchantAccountId,
      p_provider_order_id: event.providerOrderId,
      p_order_id: event.orderId,
      p_amount_minor_units: event.amountMinorUnits,
      p_currency: event.currency,
      p_occurred_at: event.occurredAt,
      p_audit: event.audit,
      p_purchased_reversal_event_id: input.purchasedReversalEventId,
      p_bonus_reversal_event_id: input.bonusReversalEventId,
      p_now: input.now,
    });
    assertRpc("reverse_point_payment", error);
    const result = data as { order: Record<string, unknown>; account: unknown; recoveredPoints: number | string; shortfallPoints: number | string };
    return {
      order: orderFromJson(result.order), account: accountFromJson(result.account),
      recoveredPoints: Number(result.recoveredPoints), shortfallPoints: Number(result.shortfallPoints),
    };
  }
}
