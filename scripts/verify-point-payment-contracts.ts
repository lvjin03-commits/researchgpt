import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createPointPurchaseQuote, type PointPaymentOrder, type VerifiedReversalPaymentEvent, type VerifiedSuccessfulPaymentEvent } from "../lib/billing/domain/payment-contracts.ts";
import { PointPaymentService } from "../lib/billing/application/payment-service.ts";
import { SignedTestPaymentProvider } from "../lib/billing/infrastructure/testing/signed-test-payment-provider.ts";
import type { PaymentRepository } from "../lib/billing/ports/payment-repository.ts";
import type { PointAccountSnapshot } from "../lib/billing/domain/contracts.ts";

class MemoryPaymentRepository implements PaymentRepository {
  readonly orders = new Map<string, PointPaymentOrder>();
  readonly events = new Map<string, string>();
  readonly balances = new Map<string, number>();
  readonly riskHolds = new Set<string>();
  readonly reversals = new Map<string, { recoveredPoints: number; shortfallPoints: number }>();

  async createPendingOrder(order: PointPaymentOrder) {
    this.orders.set(order.orderId, order);
    return order;
  }
  async attachProviderOrder(input: { orderId: string; ownerId: string; providerOrderId: string }) {
    const order = this.orders.get(input.orderId)!;
    assert.equal(order.ownerId, input.ownerId);
    const updated = { ...order, providerOrderId: input.providerOrderId };
    this.orders.set(order.orderId, updated);
    return updated;
  }
  async getOrderForOwner(orderId: string, ownerId: string) {
    const order = this.orders.get(orderId);
    return order?.ownerId === ownerId ? order : null;
  }
  async confirmSuccessfulPayment(input: {
    event: VerifiedSuccessfulPaymentEvent; purchasedLotId: string; bonusLotId: string | null;
    purchasedGrantEventId: string; bonusGrantEventId: string | null; now: string;
  }): Promise<{ order: PointPaymentOrder; account: PointAccountSnapshot }> {
    const duplicateOrder = this.events.get(`${input.event.provider}:${input.event.providerEventId}`);
    if (duplicateOrder) {
      if (duplicateOrder !== input.event.orderId) throw new Error("provider_event_conflict");
      return this.result(this.orders.get(duplicateOrder)!);
    }
    const order = this.orders.get(input.event.orderId)!;
    if (order.provider !== input.event.provider || order.merchantAccountId !== input.event.merchantAccountId ||
        order.providerOrderId !== input.event.providerOrderId || order.amountMinorUnits !== input.event.amountMinorUnits ||
        order.currency !== input.event.currency) throw new Error("verified_payment_mismatch");
    this.events.set(`${input.event.provider}:${input.event.providerEventId}`, order.orderId);
    const paid = { ...order, status: "paid" as const, paidAt: input.event.occurredAt };
    this.orders.set(order.orderId, paid);
    this.balances.set(order.ownerId, (this.balances.get(order.ownerId) ?? 0) + order.purchasedPoints + order.bonusPoints);
    return this.result(paid);
  }
  async reversePayment(input: { event: VerifiedReversalPaymentEvent; purchasedReversalEventId: string; bonusReversalEventId: string; now: string }) {
    const key = `${input.event.provider}:${input.event.providerEventId}`;
    const replay = this.reversals.get(key);
    const order = this.orders.get(input.event.orderId)!;
    if (replay) return { order, account: this.result(order).account, ...replay };
    if (order.status !== "paid") throw new Error("payment_order_not_reversible");
    if (order.provider !== input.event.provider || order.merchantAccountId !== input.event.merchantAccountId ||
        order.providerOrderId !== input.event.providerOrderId || order.amountMinorUnits !== input.event.amountMinorUnits) {
      throw new Error("verified_payment_mismatch");
    }
    const expected = order.purchasedPoints + order.bonusPoints;
    const available = this.balances.get(order.ownerId) ?? 0;
    const recoveredPoints = Math.min(available, expected);
    const shortfallPoints = expected - recoveredPoints;
    this.balances.set(order.ownerId, available - recoveredPoints);
    if (shortfallPoints > 0) this.riskHolds.add(order.ownerId);
    const reversed = { ...order, status: "reversed" as const };
    this.orders.set(order.orderId, reversed);
    this.reversals.set(key, { recoveredPoints, shortfallPoints });
    return { order: reversed, account: this.result(reversed).account, recoveredPoints, shortfallPoints };
  }
  private result(order: PointPaymentOrder) {
    const total = this.balances.get(order.ownerId) ?? 0;
    const now = order.paidAt ?? order.createdAt;
    return {
      order,
      account: {
        account: { accountId: randomUUID(), ownerId: order.ownerId, status: this.riskHolds.has(order.ownerId) ? "risk_hold" as const : "active" as const, availablePoints: total, reservedPoints: 0, lifetimeSpentPoints: 0, version: 1, createdAt: order.createdAt, updatedAt: now },
        lots: [],
      },
    };
  }
}

assert.deepEqual(createPointPurchaseQuote({ requestedPoints: 316, policy: { minimumPoints: 1, maximumPoints: 100_000 } }), {
  purchasedPoints: 316, bonusPoints: 41, amountMinorUnits: 316, currency: "CNY",
  purchasePolicyVersion: "point-purchase-v1", bonusCampaignVersion: "launch-bonus-v1",
});
assert.throws(() => createPointPurchaseQuote({ requestedPoints: 0, policy: { minimumPoints: 1, maximumPoints: 100_000 } }));

const repository = new MemoryPaymentRepository();
const provider = new SignedTestPaymentProvider({ merchantAccountId: "merchant-test", secret: "test-secret-at-least-sixteen", runtimeEnvironment: "test" });
assert.throws(() => new SignedTestPaymentProvider({ merchantAccountId: "merchant-test", secret: "test-secret-at-least-sixteen", runtimeEnvironment: "production" }));
const ids = Array.from({ length: 24 }, () => randomUUID());
const service = new PointPaymentService(repository, provider, { minimumPoints: 1, maximumPoints: 100_000 }, () => ids.shift()!, () => "2026-08-23T00:00:00.000Z");
const ownerId = randomUUID();
const checkout = await service.createCheckout({ ownerId, requestedPoints: 316 });
assert.equal(checkout.order.amountMinorUnits, 316);
assert.equal(checkout.order.bonusPoints, 41);

const payload = new TextEncoder().encode(JSON.stringify({
  providerEventId: "evt-1", merchantAccountId: provider.merchantAccountId,
  providerOrderId: checkout.checkout.providerOrderId, orderId: checkout.order.orderId,
  amountMinorUnits: 316, currency: "CNY", occurredAt: "2026-08-23T00:01:00.000Z",
}));
const headers = new Headers({ "x-test-payment-signature": provider.sign(payload) });
const paid = await service.confirmWebhook({ rawBody: payload, headers });
assert.equal(paid.order.status, "paid");
assert.equal(paid.account.account.availablePoints, 357);
const duplicate = await service.confirmWebhook({ rawBody: payload, headers });
assert.equal(duplicate.account.account.availablePoints, 357, "duplicate webhook must not grant twice");

const tampered = new TextEncoder().encode(Buffer.from(payload).toString("utf8").replace('"amountMinorUnits":316', '"amountMinorUnits":317'));
await assert.rejects(() => service.confirmWebhook({ rawBody: tampered, headers }));
assert.equal(repository.balances.get(ownerId), 357);

repository.balances.set(ownerId, 100); // simulate 257 points already consumed
const reversalPayload = new TextEncoder().encode(JSON.stringify({
  providerEventId: "evt-reversal-1", eventKind: "chargeback",
  merchantAccountId: provider.merchantAccountId,
  providerOrderId: checkout.checkout.providerOrderId, orderId: checkout.order.orderId,
  amountMinorUnits: 316, currency: "CNY", occurredAt: "2026-08-23T00:02:00.000Z",
}));
const reversalHeaders = new Headers({ "x-test-payment-signature": provider.sign(reversalPayload) });
const reversed = await service.confirmWebhook({ rawBody: reversalPayload, headers: reversalHeaders });
assert.equal(reversed.order.status, "reversed");
assert.equal("recoveredPoints" in reversed && reversed.recoveredPoints, 100);
assert.equal("shortfallPoints" in reversed && reversed.shortfallPoints, 257);
assert.equal(reversed.account.account.availablePoints, 0);
assert.equal(reversed.account.account.status, "risk_hold");
const replayedReversal = await service.confirmWebhook({ rawBody: reversalPayload, headers: reversalHeaders });
assert.equal("shortfallPoints" in replayedReversal && replayedReversal.shortfallPoints, 257);

const root = new URL("../", import.meta.url);
const [migration, reversalMigration, runbook, workflow] = await Promise.all([
  readFile(new URL("supabase/migrations/062_point_payment_ingress.sql", root), "utf8"),
  readFile(new URL("supabase/migrations/063_payment_reversal_and_risk.sql", root), "utf8"),
  readFile(new URL("docs/billing/PAYMENT-INCIDENT-RUNBOOK.md", root), "utf8"),
  readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
]);
assert.match(migration, /FOR UPDATE/);
assert.ok((migration.match(/provider_event_id=p_provider_event_id/g) ?? []).length >= 2,
  "concurrent duplicate webhooks must be rechecked after the order lock");
assert.match(migration, /public\.grant_point_lot/);
assert.match(migration, /UNIQUE\(provider, provider_event_id\)/);
assert.match(migration, /verified_payment_mismatch/);
assert.match(reversalMigration, /reverse_point_payment/);
assert.match(reversalMigration, /authorize_point_payment_checkout/);
assert.match(reversalMigration, /pg_advisory_xact_lock/);
assert.match(reversalMigration, /status='reversed'/);
assert.match(runbook, /Do not manually edit balance columns/);
assert.match(workflow, /test:point-payment-contracts/);

console.log("Point purchase, signed webhook, idempotent grant and payment runbook contracts passed.");
