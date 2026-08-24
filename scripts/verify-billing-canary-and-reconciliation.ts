import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AI_OPERATIONS } from "../lib/ai/operation-registry.ts";
import { InMemoryPointLedgerRepository } from "../lib/billing/infrastructure/memory/in-memory-point-ledger-repository.ts";
import { InMemoryPriceCatalogRepository } from "../lib/billing/infrastructure/memory/in-memory-price-catalog-repository.ts";
import { PointBillingService } from "../lib/billing/application/point-billing-service.ts";
import { CanaryChargingCoordinator } from "../lib/billing/application/canary-charging-coordinator.ts";
import { resolveChargingRolloutPolicy } from "../lib/billing/domain/charging-rollout.ts";
import { reconcileProviderSettlements } from "../lib/billing/domain/reconciliation.ts";

const now = "2026-08-23T12:00:00.000Z";
const ownerId = randomUUID();
const ledger = new InMemoryPointLedgerRepository();
await ledger.grantLot({
  ownerId, eventId: randomUUID(), lotId: randomUUID(), grantKind: "promotional_trial",
  points: 5_000, paymentOrderId: null, campaignId: "canary-test",
  grantReason: "canary_test", policyVersion: "test-v1", expiresAt: null, now,
});
const prices = new InMemoryPriceCatalogRepository();
await prices.putPolicy({
  policyVersion: "chat-canary-price-v1", operation: AI_OPERATIONS.chat.conversation,
  provider: "openai", modelId: "canary-model",
  tokenRates: { inputMicroUsdPerMillion: 1_000_000, cachedInputMicroUsdPerMillion: 500_000, outputMicroUsdPerMillion: 1_000_000 },
  unitRates: [], cnyMicrosPerUsd: 7_000_000, markupBasisPoints: 5_000,
  rounding: "ceil_to_whole_point", effectiveFrom: "2026-08-01T00:00:00.000Z", effectiveUntil: null,
});
const billing = new PointBillingService({ ledger, prices });
const rollout = resolveChargingRolloutPolicy(JSON.stringify({
  mode: "canary", ownerIds: [ownerId], operations: [AI_OPERATIONS.chat.conversation],
  maximumDailyChargePointsPerOwner: 2_000, expiresAt: "2026-08-30T00:00:00.000Z",
  policyVersion: "canary-v1",
}));
const coordinator = new CanaryChargingCoordinator(billing, ledger, rollout);
const usageRange = {
  low: [{ kind: "tokens" as const, inputTokens: 200_000, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }],
  high: [{ kind: "tokens" as const, inputTokens: 600_000, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }],
  maximum: [{ kind: "tokens" as const, inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }],
};

let executed = false;
await assert.rejects(() => coordinator.runSingleBundle({
  ownerId, operation: AI_OPERATIONS.chat.conversation, provider: "openai", modelId: "canary-model",
  billingOperationId: randomUUID(), reservationId: randomUUID(), settlementEventId: randomUUID(), releaseEventId: randomUUID(),
  usageRange, userConfirmed: false, reservationExpiresAt: "2026-08-23T12:15:00.000Z", now,
  execute: async () => { executed = true; return { value: "no", terminalState: "delivered", usage: [] }; },
  classifyThrownFailure: () => "provider_unavailable",
}));
assert.equal(executed, false, "provider dispatch must wait for required confirmation");

const charged = await coordinator.runSingleBundle({
  ownerId, operation: AI_OPERATIONS.chat.conversation, provider: "openai", modelId: "canary-model",
  billingOperationId: randomUUID(), reservationId: randomUUID(), settlementEventId: randomUUID(), releaseEventId: randomUUID(),
  usageRange, userConfirmed: true, reservationExpiresAt: "2026-08-23T12:15:00.000Z", now,
  execute: async () => ({
    value: "delivered answer", terminalState: "delivered",
    usage: [{ kind: "tokens", inputTokens: 500_000, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }],
  }),
  classifyThrownFailure: () => "provider_unavailable",
});
assert.equal(charged.charging, "charged");
assert.equal(charged.chargedPoints, 525);

const beforeFailure = (await ledger.getAccount(ownerId))!.account.availablePoints;
await assert.rejects(() => coordinator.runSingleBundle({
  ownerId, operation: AI_OPERATIONS.chat.conversation, provider: "openai", modelId: "canary-model",
  billingOperationId: randomUUID(), reservationId: randomUUID(), settlementEventId: randomUUID(), releaseEventId: randomUUID(),
  usageRange, userConfirmed: true, reservationExpiresAt: "2026-08-23T12:15:00.000Z", now,
  execute: async () => { throw new Error("provider failed"); },
  classifyThrownFailure: () => "provider_unavailable",
}));
assert.equal((await ledger.getAccount(ownerId))!.account.availablePoints, beforeFailure, "failed output must release the reservation");

const outsider = randomUUID();
let outsiderRan = false;
const outsiderResult = await coordinator.runSingleBundle({
  ownerId: outsider, operation: AI_OPERATIONS.chat.conversation, provider: "openai", modelId: "canary-model",
  billingOperationId: randomUUID(), reservationId: randomUUID(), settlementEventId: randomUUID(), releaseEventId: randomUUID(),
  usageRange, userConfirmed: false, reservationExpiresAt: "2026-08-23T12:15:00.000Z", now,
  execute: async () => { outsiderRan = true; return { value: "metered", terminalState: "delivered", usage: [] }; },
  classifyThrownFailure: () => "provider_unavailable",
});
assert.equal(outsiderRan, true);
assert.equal(outsiderResult.charging, "meter_only");

assert.deepEqual(resolveChargingRolloutPolicy(undefined), { mode: "disabled" });
assert.throws(() => resolveChargingRolloutPolicy(JSON.stringify({ mode: "canary", ownerIds: [], operations: [], maximumDailyChargePointsPerOwner: 1, expiresAt: "2026-08-30T00:00:00.000Z", policyVersion: "bad" })));
assert.throws(() => resolveChargingRolloutPolicy(JSON.stringify({ mode: "enforced" })));

const orderId = randomUUID();
const reconciliation = reconcileProviderSettlements({
  providerRecords: [
    { provider: "provider-a", merchantAccountId: "merchant-a", providerOrderId: "external-1", status: "paid", amountMinorUnits: 316, currency: "CNY", settledAt: now },
    { provider: "provider-a", merchantAccountId: "merchant-a", providerOrderId: "missing", status: "paid", amountMinorUnits: 100, currency: "CNY", settledAt: now },
  ],
  internalOrders: [
    { orderId, provider: "provider-a", merchantAccountId: "merchant-a", providerOrderId: "external-1", status: "reversed", amountMinorUnits: 300, currency: "CNY" },
    { orderId: randomUUID(), provider: "provider-a", merchantAccountId: "merchant-a", providerOrderId: "internal-only", status: "paid", amountMinorUnits: 100, currency: "CNY" },
  ],
});
assert.deepEqual(reconciliation.map((item) => item.code).sort(), ["missing_internal_order", "missing_provider_settlement", "provider_amount_mismatch", "provider_status_mismatch"]);

const root = new URL("../", import.meta.url);
const [migration, workflow] = await Promise.all([
  readFile(new URL("supabase/migrations/064_point_statements_and_reconciliation.sql", root), "utf8"),
  readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
]);
assert.match(migration, /statement_owner_mismatch/);
assert.match(migration, /inspect_point_billing_invariants/);
assert.match(migration, /account_available_mismatch/);
assert.match(workflow, /test:billing-canary/);
console.log("Statements, reconciliation and guarded single-Bundle canary charging contracts passed.");
