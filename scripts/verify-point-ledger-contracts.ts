import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { InMemoryPointLedgerRepository } from "../lib/billing/infrastructure/memory/in-memory-point-ledger-repository.ts";
import { InsufficientPointsError, PointAccountOnHoldError } from "../lib/billing/domain/contracts.ts";

const ownerId = randomUUID();
const now = "2026-08-22T12:00:00.000Z";
const later = "2026-08-22T12:10:00.000Z";
const repository = new InMemoryPointLedgerRepository();

const purchasedLotId = randomUUID();
const purchaseEvent = randomUUID();
await repository.grantLot({
  ownerId, eventId: purchaseEvent, lotId: purchasedLotId, grantKind: "purchased",
  points: 1_000, paymentOrderId: "order-001", campaignId: null,
  grantReason: "test_purchase", policyVersion: "point-policy-v1", expiresAt: null, now,
});
await repository.grantLot({
  ownerId, eventId: randomUUID(), lotId: randomUUID(), grantKind: "purchase_bonus",
  points: 130, paymentOrderId: "order-001", campaignId: "launch-2026",
  grantReason: "launch_bonus", policyVersion: "point-policy-v1",
  expiresAt: "2026-09-30T00:00:00.000Z", now,
});

const replay = await repository.grantLot({
  ownerId, eventId: purchaseEvent, lotId: purchasedLotId, grantKind: "purchased",
  points: 1_000, paymentOrderId: "order-001", campaignId: null,
  grantReason: "test_purchase", policyVersion: "point-policy-v1", expiresAt: null, now,
});
assert.equal(replay.account.availablePoints, 1_000, "idempotent grant must return its original committed result");
assert.equal((await repository.getAccount(ownerId))!.account.availablePoints, 1_130, "duplicate event must not grant twice");

const concurrent = await Promise.allSettled(Array.from({ length: 12 }, async () => repository.reserve({
  ownerId, reservationId: randomUUID(), billingOperationId: randomUUID(), points: 100,
  pricePolicyVersion: "price-v1", expiresAt: "2026-08-22T13:00:00.000Z", now,
})));
assert.equal(concurrent.filter((item) => item.status === "fulfilled").length, 11);
assert.equal(concurrent.filter((item) => item.status === "rejected" && item.reason instanceof InsufficientPointsError).length, 1);
assert.equal((await repository.getAccount(ownerId))!.account.availablePoints, 30);
assert.equal((await repository.getAccount(ownerId))!.account.reservedPoints, 1_100);

const successfulReservations = concurrent.flatMap((item) => item.status === "fulfilled" ? [item.value] : []);
const first = successfulReservations[0];
const settleEvent = randomUUID();
const settled = await repository.settle({ ownerId, eventId: settleEvent, reservationId: first.reservationId, settledPoints: 60, reason: "delivered", now: later });
assert.equal(settled.settledPoints, 60);
assert.equal(settled.releasedPoints, 40);
assert.deepEqual(await repository.settle({ ownerId, eventId: settleEvent, reservationId: first.reservationId, settledPoints: 60, reason: "delivered", now: later }), settled);

const second = successfulReservations[1];
const released = await repository.release({ ownerId, eventId: randomUUID(), reservationId: second.reservationId, reason: "provider_timeout", now: later });
assert.equal(released.status, "released");
assert.equal(released.releasedPoints, 100);

for (const reservation of successfulReservations.slice(2)) {
  await repository.release({ ownerId, eventId: randomUUID(), reservationId: reservation.reservationId, reason: "test_cleanup", now: later });
}
const afterFinalize = (await repository.getAccount(ownerId))!.account;
assert.equal(afterFinalize.availablePoints, 1_070);
assert.equal(afterFinalize.reservedPoints, 0);
assert.equal(afterFinalize.lifetimeSpentPoints, 60);

const reversal = await repository.reverseLot({ ownerId, eventId: randomUUID(), lotId: purchasedLotId, points: 2_000, reason: "chargeback", now: later });
assert.equal(reversal.recoveredPoints, 1_000);
assert.equal(reversal.shortfallPoints, 1_000);
assert.equal(reversal.account.availablePoints, 70);
assert.equal(reversal.account.status, "risk_hold");
assert.equal((await repository.listShortfalls(ownerId)).length, 1);
await assert.rejects(() => repository.reserve({
  ownerId, reservationId: randomUUID(), billingOperationId: randomUUID(), points: 1,
  pricePolicyVersion: "price-v1", expiresAt: "2026-08-22T13:00:00.000Z", now: later,
}), PointAccountOnHoldError);

const transactions = await repository.listTransactions(ownerId);
assert.ok(transactions.length > 10);
assert.equal(new Set(transactions.map((item) => `${item.eventId}:${item.kind}:${item.reservationId ?? ""}`)).size, transactions.length);

const migration = await readFile(new URL("../supabase/migrations/059_site_wide_point_ledger.sql", import.meta.url), "utf8");
for (const required of [
  "CREATE TABLE public.point_accounts", "CREATE TABLE public.point_lots",
  "CREATE TABLE public.point_reservations", "CREATE TABLE public.point_reservation_allocations",
  "CREATE TABLE public.point_transactions", "CREATE TABLE public.point_recovery_shortfalls",
  "FOR UPDATE", "UNIQUE (account_id, event_id, sequence)",
  "CHECK (available_points >= 0)", "CHECK (reserved_points >= 0)",
  "GRANT EXECUTE ON FUNCTION public.reserve_points", "TO service_role",
]) assert.ok(migration.includes(required), `migration missing ${required}`);

console.log("Point ledger domain, concurrency, idempotency, release, settlement, reversal and migration contracts passed.");
