import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AI_OPERATIONS } from "../lib/ai/operation-registry.ts";
import { tokenUsage } from "../lib/ai/billable-usage.ts";
import { AtomicDeliveryChargingCoordinator } from "../lib/billing/application/atomic-delivery-charging-coordinator.ts";
import { AtomicDeliveryCanaryChargingCoordinator } from "../lib/billing/application/atomic-delivery-canary-charging-coordinator.ts";
import { PointBillingService } from "../lib/billing/application/point-billing-service.ts";
import { BillingChargeLimitExceededError, InsufficientPointsError, PointAccountOnHoldError } from "../lib/billing/domain/contracts.ts";
import { InMemoryPriceCatalogRepository } from "../lib/billing/infrastructure/memory/in-memory-price-catalog-repository.ts";
import { InMemoryPointLedgerRepository } from "../lib/billing/infrastructure/memory/in-memory-point-ledger-repository.ts";

const now = "2026-09-11T12:00:00.000Z";
const ownerId = randomUUID();
const modelId = "canary-test-model";
const operation = AI_OPERATIONS.grant.webAnswerSynthesize;
const makeStage = () => ({
  bundleKey: "grounded_answer",
  operation,
  provider: "openai",
  modelId,
  billingOperationId: randomUUID(),
  reservationId: randomUUID(),
  usageRange: {
    low: [tokenUsage({ inputTokens: 10 })],
    high: [tokenUsage({ inputTokens: 20 })],
    maximum: [tokenUsage({ inputTokens: 30 })],
  },
});
const delivered = async () => ({
  value: "answer",
  terminalState: "delivered",
  actualUsageByBundle: { grounded_answer: [tokenUsage({ inputTokens: 10 })] },
});

const prices = new InMemoryPriceCatalogRepository();
await prices.putPolicy({
  policyVersion: "canary-test-v1", operation, provider: "openai", modelId,
  tokenRates: { inputMicroUsdPerMillion: 1_000_000, cachedInputMicroUsdPerMillion: 100_000, outputMicroUsdPerMillion: 2_000_000 },
  unitRates: [], cnyMicrosPerUsd: 7_000_000, markupBasisPoints: 0, rounding: "ceil_to_whole_point",
  effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveUntil: null,
});
const ledger = new InMemoryPointLedgerRepository();
const atomic = new AtomicDeliveryChargingCoordinator(new PointBillingService({ ledger, prices }));
const canaryPolicy = (maximumDailyChargePointsPerOwner = 500) => ({
  mode: "canary" as const,
  ownerIds: [ownerId],
  operations: [operation],
  maximumDailyChargePointsPerOwner,
  expiresAt: "2026-09-12T00:00:00.000Z",
  policyVersion: "test-v1",
});
const run = (coordinator: AtomicDeliveryCanaryChargingCoordinator, execute = delivered) => coordinator.run({
  ownerId, rolloutOperation: operation, parentBillingOperationId: randomUUID(), stages: [makeStage()],
  maximumChargePoints: 50, reservationExpiresAt: "2026-09-11T12:15:00.000Z", now, execute,
});

let dispatches = 0;
const disabled = new AtomicDeliveryCanaryChargingCoordinator({ atomic, ledger, rollout: { mode: "disabled" } });
const meterOnly = await run(disabled, async () => { dispatches += 1; return delivered(); });
assert.equal(meterOnly.charging, "meter_only");
assert.equal(dispatches, 1);

const canary = new AtomicDeliveryCanaryChargingCoordinator({ atomic, ledger, rollout: canaryPolicy() });
await assert.rejects(() => run(canary, async () => { dispatches += 1; return delivered(); }), InsufficientPointsError);
assert.equal(dispatches, 1, "insufficient balance must stop provider dispatch");

await ledger.grantLot({ ownerId, eventId: randomUUID(), lotId: randomUUID(), grantKind: "promotional_trial",
  points: 100, paymentOrderId: null, campaignId: "test", grantReason: "test", policyVersion: "test", expiresAt: null, now });
const charged = await run(canary, async () => { dispatches += 1; return delivered(); });
assert.equal(charged.charging, "charged");
assert.equal(dispatches, 2);

const dailyLimited = new AtomicDeliveryCanaryChargingCoordinator({ atomic, ledger, rollout: canaryPolicy(1) });
await assert.rejects(() => run(dailyLimited, async () => { dispatches += 1; return delivered(); }), BillingChargeLimitExceededError);
assert.equal(dispatches, 2, "daily ceiling must stop provider dispatch");

const holdOwnerId = randomUUID();
const holdLotId = randomUUID();
await ledger.grantLot({ ownerId: holdOwnerId, eventId: randomUUID(), lotId: holdLotId, grantKind: "promotional_trial",
  points: 100, paymentOrderId: null, campaignId: "hold-test", grantReason: "test", policyVersion: "test", expiresAt: null, now });
await ledger.reverseLot({ ownerId: holdOwnerId, eventId: randomUUID(), lotId: holdLotId,
  points: 101, reason: "forced_reversal", now });
const holdCoordinator = new AtomicDeliveryCanaryChargingCoordinator({ atomic, ledger, rollout: {
  ...canaryPolicy(), ownerIds: [holdOwnerId],
} });
await assert.rejects(() => holdCoordinator.run({ ownerId: holdOwnerId, rolloutOperation: operation,
  parentBillingOperationId: randomUUID(), stages: [makeStage()], maximumChargePoints: 50,
  reservationExpiresAt: "2026-09-11T12:15:00.000Z", now, execute: delivered }), PointAccountOnHoldError);

console.log("Atomic delivery canary guard verified: meter-only bypass, insufficient balance, daily ceiling, hold and successful charging.");
