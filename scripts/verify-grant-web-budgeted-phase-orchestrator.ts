import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResumableWebAnswerBudgetCoordinator } from "../lib/billing/application/resumable-web-answer-budget-coordinator.ts";
import { createResumableWebAnswerBudget } from "../lib/billing/domain/resumable-web-answer-budget.ts";
import { GrantWebBudgetedPhaseOrchestrator } from "../lib/grants/application/grant-web-budgeted-phase-orchestrator.ts";
import { getGrantWebBudgetOperationPolicy } from "../lib/grants/model-execution/web-budget-operation-policies.ts";

const state = createResumableWebAnswerBudget({
  budgetId: randomUUID(), ownerId: randomUUID(), documentId: randomUUID(), turnId: randomUUID(),
  authorizationId: randomUUID(), authorizedPoints: 60, decisionHardMaximumPoints: 5,
  deliveryHardMaximumPoints: 15,
});
let reserves = 0;
let invocations = 0;
let settledCheckpoint: unknown;
const orchestrator = new GrantWebBudgetedPhaseOrchestrator(new ResumableWebAnswerBudgetCoordinator({
  async reserve() { reserves += 1; }, async settle(input) { settledCheckpoint = input.checkpointArtifact; }, async release() {},
}));
const queryPolicy = getGrantWebBudgetOperationPolicy("query_rewrite");
const plannedCall = { inputTokens: 1_000, outputTokens: 100, toolCalls: 0,
  providerAttempts: 1, timeoutMilliseconds: 10_000 };
const completed = await orchestrator.execute({ state, phaseId: randomUUID(), operationKey: "query_rewrite",
  quote: { operation: queryPolicy.operation, pricePolicyVersion: "quote-v1", maximumChargePoints: 10 },
  plannedCall, invoke: async () => { invocations += 1; return { value: "rewritten", chargedPoints: 8,
    checkpointArtifact: { documentId: state.documentId, turnId: state.turnId } }; },
});
assert.equal(completed.status, "completed");
assert.equal(reserves, 1);
assert.equal(invocations, 1);
assert.deepEqual(settledCheckpoint, { documentId: state.documentId, turnId: state.turnId });

await assert.rejects(() => orchestrator.execute({ state, phaseId: randomUUID(), operationKey: "query_rewrite",
  quote: { operation: queryPolicy.operation, pricePolicyVersion: "quote-v1", maximumChargePoints: 10 },
  plannedCall: { ...plannedCall, outputTokens: queryPolicy.maximumOutputTokens + 1 },
  invoke: async () => { invocations += 1; return { value: "forbidden", chargedPoints: 1 }; },
}), /Operation Policy/u);
assert.equal(reserves, 1, "policy rejection must happen before reservation");
assert.equal(invocations, 1, "policy rejection must happen before provider invocation");

const searchPolicy = getGrantWebBudgetOperationPolicy("search_query");
await assert.rejects(() => orchestrator.execute({ state, phaseId: randomUUID(), operationKey: "search_query",
  quote: { operation: queryPolicy.operation, pricePolicyVersion: "quote-v1", maximumChargePoints: 10 },
  plannedCall: { inputTokens: 100, outputTokens: 50, toolCalls: 1, providerAttempts: 1,
    timeoutMilliseconds: 10_000, maximumResults: searchPolicy.maximumResults },
  invoke: async () => ({ value: "forbidden", chargedPoints: 1 }),
}), /does not belong/u);

const constrained = createResumableWebAnswerBudget({
  budgetId: randomUUID(), ownerId: randomUUID(), documentId: randomUUID(), turnId: randomUUID(),
  authorizationId: randomUUID(), authorizedPoints: 20, decisionHardMaximumPoints: 5,
  deliveryHardMaximumPoints: 15,
});
const paused = await orchestrator.execute({ state: constrained, phaseId: randomUUID(), operationKey: "search_query",
  quote: { operation: searchPolicy.operation, pricePolicyVersion: "quote-v1", maximumChargePoints: 10 },
  plannedCall: { inputTokens: 100, outputTokens: 50, toolCalls: 1, providerAttempts: 1,
    timeoutMilliseconds: 10_000, maximumResults: 10 },
  invoke: async () => { invocations += 1; return { value: "forbidden", chargedPoints: 1 }; },
});
assert.equal(paused.status, "awaiting_budget");
assert.equal(paused.requiredAdditionalPoints, 10);
assert.equal(reserves, 1);
assert.equal(invocations, 1);

console.log("Grant web budgeted phase policy/quote/admission orchestration passed.");
