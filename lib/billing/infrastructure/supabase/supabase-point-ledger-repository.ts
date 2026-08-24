import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PointAccountSchema,
  PointLotSchema,
  PointRecoveryShortfallSchema,
  PointReservationSchema,
  PointTransactionSchema,
  type FinalizeReservationInput,
  type GrantPointLotInput,
  type PointAccountSnapshot,
  type PointRecoveryShortfall,
  type PointReservation,
  type PointTransaction,
  type ReleaseReservationInput,
  type ReservePointsInput,
  type ReservePointBundleSetInput,
  type ReversePointLotInput,
  type ReversePointLotResult,
} from "../../domain/contracts.ts";
import type { PointLedgerRepository } from "../../ports/point-ledger-repository.ts";

function assertRpc(error: { message: string } | null): void {
  if (error) throw new Error(`Point ledger RPC failed: ${error.message}`);
}

function reservationFromRow(value: Record<string, unknown>): PointReservation {
  return PointReservationSchema.parse({
    reservationId: value.reservation_id ?? value.reservationId,
    accountId: value.account_id ?? value.accountId,
    billingOperationId: value.billing_operation_id ?? value.billingOperationId,
    requestedPoints: Number(value.requested_points ?? value.requestedPoints),
    reservedPoints: Number(value.reserved_points ?? value.reservedPoints),
    settledPoints: Number(value.settled_points ?? value.settledPoints),
    releasedPoints: Number(value.released_points ?? value.releasedPoints),
    status: value.status,
    pricePolicyVersion: value.price_policy_version ?? value.pricePolicyVersion,
    expiresAt: value.expires_at ?? value.expiresAt,
    createdAt: value.created_at ?? value.createdAt,
    finalizedAt: value.finalized_at ?? value.finalizedAt,
  });
}

function snapshotFromJson(value: unknown): PointAccountSnapshot | null {
  if (!value) return null;
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

export class SupabasePointLedgerRepository implements PointLedgerRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  async getAccount(ownerId: string): Promise<PointAccountSnapshot | null> {
    const { data, error } = await this.client.rpc("point_account_snapshot", { p_owner_id: ownerId });
    assertRpc(error);
    return snapshotFromJson(data);
  }

  async grantLot(input: GrantPointLotInput): Promise<PointAccountSnapshot> {
    const { data, error } = await this.client.rpc("grant_point_lot", {
      p_owner_id: input.ownerId, p_event_id: input.eventId, p_lot_id: input.lotId,
      p_grant_kind: input.grantKind, p_points: input.points,
      p_payment_order_id: input.paymentOrderId, p_campaign_id: input.campaignId,
      p_grant_reason: input.grantReason, p_policy_version: input.policyVersion,
      p_expires_at: input.expiresAt, p_now: input.now,
    });
    assertRpc(error);
    const snapshot = snapshotFromJson(data);
    if (!snapshot) throw new Error("Point grant returned no account snapshot.");
    return snapshot;
  }

  async reserve(input: ReservePointsInput): Promise<PointReservation> {
    const { data, error } = await this.client.rpc("reserve_points", {
      p_owner_id: input.ownerId, p_reservation_id: input.reservationId,
      p_billing_operation_id: input.billingOperationId, p_points: input.points,
      p_price_policy_version: input.pricePolicyVersion,
      p_expires_at: input.expiresAt, p_now: input.now,
    });
    assertRpc(error);
    return reservationFromRow(data as Record<string, unknown>);
  }

  async reserveBundleSet(input: ReservePointBundleSetInput): Promise<PointReservation[]> {
    const { data, error } = await this.client.rpc("reserve_point_bundle_set", {
      p_owner_id: input.ownerId,
      p_parent_billing_operation_id: input.parentBillingOperationId,
      p_bundles: input.bundles.map((bundle) => ({
        reservationId: bundle.reservationId,
        billingOperationId: bundle.billingOperationId,
        points: bundle.points,
        pricePolicyVersion: bundle.pricePolicyVersion,
        expiresAt: bundle.expiresAt,
        now: bundle.now,
      })),
    });
    assertRpc(error);
    if (!Array.isArray(data)) throw new Error("Bundle reservation RPC returned an invalid result.");
    return data.map((row) => reservationFromRow(row as Record<string, unknown>));
  }

  async settle(input: FinalizeReservationInput): Promise<PointReservation> {
    const { data, error } = await this.client.rpc("settle_point_reservation", {
      p_owner_id: input.ownerId, p_event_id: input.eventId,
      p_reservation_id: input.reservationId, p_settled_points: input.settledPoints,
      p_reason: input.reason, p_now: input.now,
    });
    assertRpc(error);
    return reservationFromRow(data as Record<string, unknown>);
  }

  async release(input: ReleaseReservationInput): Promise<PointReservation> {
    const { data, error } = await this.client.rpc("release_point_reservation", {
      p_owner_id: input.ownerId, p_event_id: input.eventId,
      p_reservation_id: input.reservationId, p_reason: input.reason, p_now: input.now,
    });
    assertRpc(error);
    return reservationFromRow(data as Record<string, unknown>);
  }

  async reverseLot(input: ReversePointLotInput): Promise<ReversePointLotResult> {
    const { data, error } = await this.client.rpc("reverse_point_lot", {
      p_owner_id: input.ownerId, p_event_id: input.eventId, p_lot_id: input.lotId,
      p_points: input.points, p_reason: input.reason, p_now: input.now,
    });
    assertRpc(error);
    const value = data as { recoveredPoints: unknown; shortfallPoints: unknown; account: Record<string, unknown> };
    return {
      recoveredPoints: Number(value.recoveredPoints),
      shortfallPoints: Number(value.shortfallPoints),
      account: PointAccountSchema.parse({
        ...value.account,
        availablePoints: Number(value.account.availablePoints),
        reservedPoints: Number(value.account.reservedPoints),
        lifetimeSpentPoints: Number(value.account.lifetimeSpentPoints),
        version: Number(value.account.version),
      }),
    };
  }

  async listTransactions(ownerId: string): Promise<PointTransaction[]> {
    const snapshot = await this.getAccount(ownerId);
    if (!snapshot) return [];
    const { data, error } = await this.client.from("point_transactions").select("*")
      .eq("account_id", snapshot.account.accountId).order("created_at", { ascending: true });
    assertRpc(error);
    return (data ?? []).map((row) => PointTransactionSchema.parse({
      transactionId: row.transaction_id, accountId: row.account_id, eventId: row.event_id,
      kind: row.kind, lotId: row.lot_id, reservationId: row.reservation_id,
      availableDelta: Number(row.available_delta), reservedDelta: Number(row.reserved_delta),
      spentDelta: Number(row.spent_delta), reason: row.reason, metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }

  async listShortfalls(ownerId: string): Promise<PointRecoveryShortfall[]> {
    const snapshot = await this.getAccount(ownerId);
    if (!snapshot) return [];
    const { data, error } = await this.client.from("point_recovery_shortfalls").select("*")
      .eq("account_id", snapshot.account.accountId).order("created_at", { ascending: true });
    assertRpc(error);
    return (data ?? []).map((row) => PointRecoveryShortfallSchema.parse({
      shortfallId: row.shortfall_id, accountId: row.account_id, lotId: row.lot_id,
      eventId: row.event_id, expectedPoints: Number(row.expected_points),
      recoveredPoints: Number(row.recovered_points), shortfallPoints: Number(row.shortfall_points),
      reason: row.reason, status: row.status, createdAt: row.created_at,
    }));
  }
}
