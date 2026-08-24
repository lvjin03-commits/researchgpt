import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AI_OPERATIONS, REGISTERED_AI_OPERATIONS } from "../lib/ai/operation-registry.ts";
import { tokenUsage } from "../lib/ai/billable-usage.ts";
import { calculateUsagePrice, requiresBillingConfirmation } from "../lib/billing/domain/price-catalog.ts";
import { BILLING_TERMINAL_STATES, getBillingOperationContract, resolveBillingDecision } from "../lib/billing/domain/deliverability.ts";
import { InMemoryPriceCatalogRepository } from "../lib/billing/infrastructure/memory/in-memory-price-catalog-repository.ts";
import { InMemoryPointLedgerRepository } from "../lib/billing/infrastructure/memory/in-memory-point-ledger-repository.ts";
import { PointBillingService } from "../lib/billing/application/point-billing-service.ts";
import { InsufficientPointsError } from "../lib/billing/domain/contracts.ts";

const now = "2026-08-22T12:00:00.000Z";
const policy = {
  policyVersion: "test-diagnostic-price-v1",
  operation: AI_OPERATIONS.grant.diagnosticSemantic,
  provider: "openai",
  modelId: "test-model",
  tokenRates: {
    inputMicroUsdPerMillion: 1_000_000,
    cachedInputMicroUsdPerMillion: 100_000,
    outputMicroUsdPerMillion: 2_000_000,
  },
  unitRates: [{ usageKind: "tool_call" as const, discriminator: "web_search", microUsdPerUnit: 10_000, unitSize: 1 }],
  cnyMicrosPerUsd: 7_000_000,
  markupBasisPoints: 5_000,
  rounding: "ceil_to_whole_point" as const,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
};

assert.equal(calculateUsagePrice({ policy, usage: [tokenUsage({ inputTokens: 1_000_000 })] }).points, 1_050);
assert.equal(calculateUsagePrice({ policy, usage: [tokenUsage({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000 })] }).points, 105);
assert.equal(calculateUsagePrice({ policy, usage: [{ kind: "tool_call", tool: "web_search", count: 2 }] }).points, 21);

for (const operation of REGISTERED_AI_OPERATIONS) {
  const contract = getBillingOperationContract(operation);
  assert.deepEqual(Object.keys(contract.deliverabilityMatrix).sort(), [...BILLING_TERMINAL_STATES].sort());
  assert.equal(contract.deliverabilityMatrix.unable_to_reverify, "release");
  assert.equal(contract.deliverabilityMatrix.ambiguous_match, "release");
}
assert.deepEqual(resolveBillingDecision({ operation: AI_OPERATIONS.grant.diagnosticSemantic, terminalState: "future_unknown_state" }), { decision: "release", unknownState: true });

const ownerId = randomUUID();
const ledger = new InMemoryPointLedgerRepository();
const prices = new InMemoryPriceCatalogRepository();
const service = new PointBillingService({ ledger, prices });
await prices.putPolicy(policy);
await assert.rejects(() => prices.putPolicy(policy), /already exists/);
await ledger.grantLot({
  ownerId, eventId: randomUUID(), lotId: randomUUID(), grantKind: "purchased", points: 1_000,
  paymentOrderId: "test-order", campaignId: null, grantReason: "test", policyVersion: "point-v1",
  expiresAt: null, now,
});

const quote = await service.quote({
  operation: AI_OPERATIONS.grant.diagnosticSemantic, provider: "openai", modelId: "test-model", now,
  bundles: [
    { bundleKey: "scientific_review_bundle", usage: {
      low: [tokenUsage({ inputTokens: 100_000 })], high: [tokenUsage({ inputTokens: 200_000 })], maximum: [tokenUsage({ inputTokens: 300_000 })],
    } },
    { bundleKey: "narrative_review_bundle", usage: {
      low: [tokenUsage({ inputTokens: 50_000 })], high: [tokenUsage({ inputTokens: 100_000 })], maximum: [tokenUsage({ inputTokens: 200_000 })],
    } },
  ],
});
assert.deepEqual(quote.bundles.map((bundle) => bundle.maximumChargePoints), [315, 210]);
assert.equal(quote.maximumChargePoints, 525);
assert.equal(requiresBillingConfirmation({ quote, availablePoints: 1_000 }), true);

const bindings = quote.bundles.map((bundle) => ({ bundleKey: bundle.bundleKey, reservationId: randomUUID(), billingOperationId: randomUUID() }));
const reservations = await service.reserveQuote({
  ownerId, parentBillingOperationId: randomUUID(), quote, bundles: bindings,
  expiresAt: "2026-08-22T13:00:00.000Z", now,
});
assert.equal(reservations.length, 2);
assert.equal((await ledger.getAccount(ownerId))!.account.reservedPoints, 525);

const scientific = quote.bundles[0];
const scientificResult = await service.finalizeBundle({
  ownerId, eventId: randomUUID(), reservationId: bindings[0].reservationId,
  operation: quote.operation, pricePolicyVersion: quote.pricePolicyVersion,
  maximumChargePoints: scientific.maximumChargePoints, terminalState: "delivered",
  actualDeliveredUsage: [tokenUsage({ inputTokens: 250_000 })], now,
});
assert.equal(scientificResult.chargedPoints, 263);

const narrativeResult = await service.finalizeBundle({
  ownerId, eventId: randomUUID(), reservationId: bindings[1].reservationId,
  operation: quote.operation, pricePolicyVersion: quote.pricePolicyVersion,
  maximumChargePoints: quote.bundles[1].maximumChargePoints, terminalState: "unable_to_reverify",
  actualDeliveredUsage: [tokenUsage({ inputTokens: 100_000 })], now,
});
assert.equal(narrativeResult.decision, "released");
assert.equal(narrativeResult.chargedPoints, 0);
assert.equal((await ledger.getAccount(ownerId))!.account.availablePoints, 737);
assert.equal((await ledger.getAccount(ownerId))!.account.reservedPoints, 0);

const smallOwner = randomUUID();
await ledger.grantLot({ ownerId: smallOwner, eventId: randomUUID(), lotId: randomUUID(), grantKind: "promotional_trial", points: 100,
  paymentOrderId: null, campaignId: "test", grantReason: "test", policyVersion: "point-v1", expiresAt: null, now });
const before = (await ledger.getAccount(smallOwner))!.account;
await assert.rejects(() => service.reserveQuote({
  ownerId: smallOwner, parentBillingOperationId: randomUUID(), quote, bundles: quote.bundles.map((bundle) => ({ bundleKey: bundle.bundleKey, reservationId: randomUUID(), billingOperationId: randomUUID() })),
  expiresAt: "2026-08-22T13:00:00.000Z", now,
}), InsufficientPointsError);
const after = (await ledger.getAccount(smallOwner))!.account;
assert.equal(after.availablePoints, before.availablePoints, "failed Bundle-set reservation must be atomic");
assert.equal(after.reservedPoints, 0);

const migration = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../supabase/migrations/060_point_price_catalog_and_bundle_reservation.sql", import.meta.url), "utf8"));
for (const required of ["CREATE TABLE public.ai_price_policies", "ai_price_policy_is_immutable", "reserve_point_bundle_set", "FOR UPDATE", "partial_bundle_set_conflict", "TO service_role"]) {
  assert.ok(migration.includes(required), `price/bundle migration missing ${required}`);
}

console.log("Price catalog, exact point math, exhaustive deliverability and atomic Bundle billing contracts passed.");
