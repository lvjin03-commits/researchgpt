import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabasePointLedgerRepository } from "../lib/billing/infrastructure/supabase/supabase-point-ledger-repository.ts";
import { AtomicDeliveryCanaryChargingCoordinator } from "../lib/billing/application/atomic-delivery-canary-charging-coordinator.ts";
import { AtomicDeliveryChargingCoordinator } from "../lib/billing/application/atomic-delivery-charging-coordinator.ts";
import { PointBillingService } from "../lib/billing/application/point-billing-service.ts";
import { InMemoryPriceCatalogRepository } from "../lib/billing/infrastructure/memory/in-memory-price-catalog-repository.ts";

// Offline: exercise the production repository, not the memory ledger's UTC-only values.
const ownerId = randomUUID();
const accountId = randomUUID();
const reservationId = randomUUID();
const billingOperationId = randomUUID();
const now = "2026-09-11T12:00:00.000Z";
let timestamp = "2026-09-11T06:30:00.123456-05:00";
const account = () => ({ accountId, ownerId, status: "active", availablePoints: 226,
  reservedPoints: 0, lifetimeSpentPoints: 10, version: 1, createdAt: timestamp, updatedAt: timestamp });
const reservation = (status: string) => ({ reservation_id: reservationId, account_id: accountId,
  billing_operation_id: billingOperationId, requested_points: 50, reserved_points: 50,
  settled_points: status === "settled" ? 10 : 0, released_points: status === "released" ? 50 : 0,
  status, price_policy_version: "test-v1", expires_at: timestamp, created_at: timestamp,
  finalized_at: status === "reserved" ? null : timestamp });
const client = {
  async rpc(name: string) {
    if (name === "point_account_snapshot") return { data: { account: account(), lots: [] }, error: null };
    if (name === "reverse_point_lot") return { data: { account: account(), recoveredPoints: 1, shortfallPoints: 0 }, error: null };
    if (name === "reserve_point_bundle_set") return { data: [reservation("reserved")], error: null };
    return { data: reservation(name === "settle_point_reservation" ? "settled" : name === "release_point_reservation" ? "released" : "reserved"), error: null };
  },
  from(table: string) {
    return { select() { return { eq() { return { async order() {
      return { error: null, data: table === "point_transactions" ? [{
        transaction_id: randomUUID(), account_id: accountId, event_id: randomUUID(), kind: "settle",
        lot_id: null, reservation_id: reservationId, available_delta: 0, reserved_delta: -10,
        spent_delta: 10, reason: "delivered", metadata: {}, created_at: timestamp,
      }] : [{ shortfall_id: randomUUID(), account_id: accountId, lot_id: randomUUID(),
        event_id: randomUUID(), expected_points: 2, recovered_points: 1, shortfall_points: 1,
        reason: "chargeback", status: "open", created_at: timestamp }] };
    } }; } }; } };
  },
} as unknown as SupabaseClient;
const ledger = new SupabasePointLedgerRepository(client);
const coordinator = new AtomicDeliveryCanaryChargingCoordinator({ ledger,
  atomic: new AtomicDeliveryChargingCoordinator(new PointBillingService({ ledger, prices: new InMemoryPriceCatalogRepository() })),
  rollout: { mode: "canary", ownerIds: [ownerId], operations: ["grant.assistant.chat"],
    maximumDailyChargePointsPerOwner: 200, expiresAt: "2026-09-18T00:00:00.000Z", policyVersion: "test-v1" },
});
const input = { ownerId, reservationId, billingOperationId, points: 50, pricePolicyVersion: "test-v1", expiresAt: now, now };
for (const value of [timestamp, "2026-09-11T11:30:00+00:00", "2026-09-11T11:30:00.000Z"]) {
  timestamp = value;
  const expected = new Date(timestamp).toISOString();
  const preview = await coordinator.preview({ ownerId, operation: "grant.assistant.chat", maximumChargePoints: 50, now });
  assert.equal(preview.canSubmit, true);
  assert.equal(preview.availablePoints, 226);
  assert.equal((await ledger.listTransactions(ownerId))[0].createdAt, expected);
  assert.equal((await ledger.reserve(input)).createdAt, expected);
  assert.equal((await ledger.reserve(input)).finalizedAt, null);
  assert.equal((await ledger.reserveBundleSet({ ownerId, parentBillingOperationId: randomUUID(), bundles: [input] }))[0].expiresAt, expected);
  assert.equal((await ledger.settle({ ownerId, reservationId, eventId: randomUUID(), settledPoints: 10, reason: "delivered", now })).finalizedAt, expected);
  assert.equal((await ledger.release({ ownerId, reservationId, eventId: randomUUID(), reason: "failed", now })).finalizedAt, expected);
  assert.equal((await ledger.reverseLot({ ownerId, lotId: randomUUID(), eventId: randomUUID(), points: 1, reason: "chargeback", now })).account.updatedAt, expected);
  assert.equal((await ledger.listShortfalls(ownerId))[0].createdAt, expected);
  assert.equal((await coordinator.preview({ ownerId, operation: "grant.assistant.chat", maximumChargePoints: 195, now })).canSubmit, false, "normalized timestamps must still count daily spending");
}
timestamp = "invalid-private-value";
await assert.rejects(() => ledger.listTransactions(ownerId), /Invalid point ledger timestamp/);
console.log("Supabase ledger timestamp and Canary preview regressions passed (offline, no provider calls).");
