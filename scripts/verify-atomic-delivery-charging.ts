import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AI_OPERATIONS } from "../lib/ai/operation-registry.ts";
import { tokenUsage } from "../lib/ai/billable-usage.ts";
import { AtomicDeliveryChargingCoordinator } from "../lib/billing/application/atomic-delivery-charging-coordinator.ts";
import { PointBillingService } from "../lib/billing/application/point-billing-service.ts";
import { InMemoryPriceCatalogRepository } from "../lib/billing/infrastructure/memory/in-memory-price-catalog-repository.ts";
import { InMemoryPointLedgerRepository } from "../lib/billing/infrastructure/memory/in-memory-point-ledger-repository.ts";

const now = "2026-09-11T12:00:00.000Z";
const modelId = "billing-test-model";
const operations = [
  ["query_rewrite", AI_OPERATIONS.grant.webQueryRewrite],
  ["search_query", AI_OPERATIONS.grant.webSearchQuery],
  ["source_assessment", AI_OPERATIONS.grant.webSourceAssess],
  ["grounded_answer", AI_OPERATIONS.grant.webAnswerSynthesize],
] as const;
const prices = new InMemoryPriceCatalogRepository();
for (const [bundleKey, operation] of operations) {
  await prices.putPolicy({
    policyVersion: `test-${bundleKey}-v1`, operation, provider: "openai", modelId,
    tokenRates: { inputMicroUsdPerMillion: 1_000_000, cachedInputMicroUsdPerMillion: 100_000,
      outputMicroUsdPerMillion: 2_000_000 },
    unitRates: operation === AI_OPERATIONS.grant.webSearchQuery
      ? [{ usageKind: "tool_call", discriminator: "openai_web_search", microUsdPerUnit: 10_000, unitSize: 1 }]
      : [],
    cnyMicrosPerUsd: 7_000_000, markupBasisPoints: 0, rounding: "ceil_to_whole_point",
    effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveUntil: null,
  });
}

const ledger = new InMemoryPointLedgerRepository();
const billing = new PointBillingService({ ledger, prices });
const coordinator = new AtomicDeliveryChargingCoordinator(billing);
const makeStages = () => operations.map(([bundleKey, operation]) => ({
  bundleKey, operation, provider: "openai", modelId,
  billingOperationId: randomUUID(), reservationId: randomUUID(),
  usageRange: {
    low: operation === AI_OPERATIONS.grant.webSearchQuery
      ? [{ kind: "tool_call" as const, tool: "openai_web_search", count: 1 }, tokenUsage({ inputTokens: 500 })]
      : [tokenUsage({ inputTokens: 500 })],
    high: operation === AI_OPERATIONS.grant.webSearchQuery
      ? [{ kind: "tool_call" as const, tool: "openai_web_search", count: 1 }, tokenUsage({ inputTokens: 1_000 })]
      : [tokenUsage({ inputTokens: 1_000 })],
    maximum: operation === AI_OPERATIONS.grant.webSearchQuery
      ? [{ kind: "tool_call" as const, tool: "openai_web_search", count: 2 }, tokenUsage({ inputTokens: 2_000 })]
      : [tokenUsage({ inputTokens: 2_000 })],
  },
}));
const grantPoints = async (ownerId: string) => ledger.grantLot({ ownerId, eventId: randomUUID(), lotId: randomUUID(),
  grantKind: "promotional_trial", points: 1_000, paymentOrderId: null, campaignId: "test",
  grantReason: "test", policyVersion: "test", expiresAt: null, now });

const successfulOwner = randomUUID();
await grantPoints(successfulOwner);
let reservedDuringExecution = 0;
const successful = await coordinator.run({ ownerId: successfulOwner, parentBillingOperationId: randomUUID(),
  stages: makeStages(), reservationExpiresAt: "2026-09-11T13:00:00.000Z", now,
  execute: async () => {
    reservedDuringExecution = (await ledger.getAccount(successfulOwner))!.account.reservedPoints;
    return { value: "answer", terminalState: "delivered", actualUsageByBundle: {
      query_rewrite: [tokenUsage({ inputTokens: 1_000 })],
      search_query: [{ kind: "tool_call", tool: "openai_web_search", count: 1 }, tokenUsage({ inputTokens: 1_000 })],
      source_assessment: [tokenUsage({ inputTokens: 1_000 })],
      grounded_answer: [tokenUsage({ inputTokens: 1_000 })],
    } };
  } });
assert.ok(reservedDuringExecution > successful.chargedPoints, "maximum cost must be reserved before execution");
assert.equal(successful.value, "answer");
assert.equal(successful.charging, "charged");
assert.equal(successful.chargedPoints, 11);
assert.equal((await ledger.getAccount(successfulOwner))!.account.availablePoints, 989);
assert.equal((await ledger.getAccount(successfulOwner))!.account.reservedPoints, 0);

const failedOwner = randomUUID();
await grantPoints(failedOwner);
await assert.rejects(() => coordinator.run({ ownerId: failedOwner, parentBillingOperationId: randomUUID(),
  stages: makeStages(), reservationExpiresAt: "2026-09-11T13:00:00.000Z", now,
  execute: async () => { throw new Error("synthesis failed"); } }), /synthesis failed/u);
assert.equal((await ledger.getAccount(failedOwner))!.account.availablePoints, 1_000, "failed delivery must charge nothing");
assert.equal((await ledger.getAccount(failedOwner))!.account.reservedPoints, 0, "failed delivery must release every stage");
assert.equal((await ledger.getAccount(failedOwner))!.account.lifetimeSpentPoints, 0);

const undeliveredOwner = randomUUID();
await grantPoints(undeliveredOwner);
const undelivered = await coordinator.run({ ownerId: undeliveredOwner, parentBillingOperationId: randomUUID(),
  stages: makeStages(), reservationExpiresAt: "2026-09-11T13:00:00.000Z", now,
  execute: async () => ({ value: "fallback", terminalState: "succeeded_internal_only", actualUsageByBundle: {} }) });
assert.equal(undelivered.charging, "released");
assert.equal(undelivered.chargedPoints, 0);
assert.equal((await ledger.getAccount(undeliveredOwner))!.account.availablePoints, 1_000);

console.log("Atomic four-stage delivery billing verified: pre-reserve, delivered actual settlement, failed release and internal-only release.");
