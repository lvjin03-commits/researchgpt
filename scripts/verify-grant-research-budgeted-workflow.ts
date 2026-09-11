import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResumableWebAnswerBudgetCoordinator } from "../lib/billing/application/resumable-web-answer-budget-coordinator.ts";
import { createResumableWebAnswerBudget } from "../lib/billing/domain/resumable-web-answer-budget.ts";
import { GrantResearchBudgetedWorkflow } from "../lib/grants/application/grant-research-budgeted-workflow.ts";

let state = createResumableWebAnswerBudget({ budgetId: randomUUID(), ownerId: randomUUID(), documentId: randomUUID(),
  turnId: randomUUID(), authorizationId: randomUUID(), authorizedPoints: 40,
  decisionHardMaximumPoints: 5, deliveryHardMaximumPoints: 15 });
const events: string[] = [];
const coordinator = new ResumableWebAnswerBudgetCoordinator({
  async reserve({ phaseId }) { events.push(`reserve:${phaseId}`); },
  async settle({ phaseId }) { events.push(`settle:${phaseId}`); },
  async release({ phaseId }) { events.push(`release:${phaseId}`); },
});
const quotes = new Map([
  ["grant.web_next_step.decide", 5], ["grant.web_search.query", 15],
  ["grant.web_source.assess", 10], ["grant.web_gap.compare", 10],
  ["grant.web_existing_results.deliver", 15],
]);
const workflow = new GrantResearchBudgetedWorkflow({ coordinator,
  pricing: { async quote({ operation }) { return { operation, maximumChargePoints: quotes.get(operation)!, pricePolicyVersion: `test:${operation}` }; } },
  stateTransitions: { async transition(_previous, next) { events.push("transition:delivery"); return next; } },
});

const decisionId = randomUUID();
let result = await workflow.executePaidPhase({ state, phaseId: decisionId, policyKey: "next_step_decision",
  plannedCall: { inputTokens: 1000, outputTokens: 200, toolCalls: 0, providerAttempts: 1, timeoutMilliseconds: 10_000 },
  invoke: async () => { events.push(`invoke:${decisionId}`); return { value: "plan", chargedPoints: 3 }; } });
assert.equal(result.status, "completed");
if (result.status !== "completed") throw new Error("Expected decision completion.");
state = result.state;

const searchId = randomUUID();
result = await workflow.executePaidPhase({ state, phaseId: searchId, policyKey: "search_query",
  plannedCall: { inputTokens: 1000, outputTokens: 300, toolCalls: 1, providerAttempts: 1, timeoutMilliseconds: 20_000, maximumResults: 10 },
  invoke: async () => { events.push(`invoke:${searchId}`); return { value: "sources", chargedPoints: 12, checkpointArtifact: { documentId: state.documentId, turnId: state.turnId } }; } });
assert.equal(result.status, "completed");
if (result.status !== "completed") throw new Error("Expected search completion.");
state = result.state;

const assessmentId = randomUUID();
result = await workflow.executePaidPhase({ state, phaseId: assessmentId, policyKey: "source_assessment",
  plannedCall: { inputTokens: 5000, outputTokens: 1000, toolCalls: 0, providerAttempts: 1, timeoutMilliseconds: 30_000 },
  invoke: async () => { events.push(`invoke:${assessmentId}`); return { value: "assessment", chargedPoints: 8 }; } });
assert.equal(result.status, "completed");
if (result.status !== "completed") throw new Error("Expected assessment completion.");
state = result.state;
assert.equal(state.settledPoints, 23);

let blockedInvocations = 0;
const comparisonId = randomUUID();
const blocked = await workflow.executePaidPhase({ state, phaseId: comparisonId, policyKey: "gap_comparison",
  plannedCall: { inputTokens: 8000, outputTokens: 1500, toolCalls: 0, providerAttempts: 1, timeoutMilliseconds: 30_000 },
  invoke: async () => { blockedInvocations += 1; return { value: "must not run", chargedPoints: 1 }; } });
assert.equal(blocked.status, "awaiting_budget");
assert.equal(blockedInvocations, 0, "an over-budget comparison must pause before provider invocation");
assert.equal(blocked.requiredAdditionalPoints, 8, "23 settled + 10 comparison + 15 delivery exceeds 40 by 8");
assert(!events.includes(`reserve:${comparisonId}`), "an over-budget comparison must not reserve points");

const deliveryId = randomUUID();
const partial = await workflow.declineIncreaseAndDeliver({ state: blocked.state, phaseId: deliveryId,
  plannedCall: { inputTokens: 8000, outputTokens: 1000, toolCalls: 0, providerAttempts: 1, timeoutMilliseconds: 30_000 },
  invoke: async () => { events.push(`invoke:${deliveryId}`); return { value: "bounded current results", chargedPoints: 12 }; } });
assert.equal(partial.status, "completed");
if (partial.status !== "completed") throw new Error("Expected partial delivery.");
assert.equal(partial.state.status, "delivered_partial");
assert.equal(partial.state.settledPoints, 35);
assert(events.indexOf(`reserve:${deliveryId}`) < events.indexOf(`invoke:${deliveryId}`), "delivery must reserve before invocation");

await assert.rejects(() => workflow.executePaidPhase({ state: createResumableWebAnswerBudget({
  budgetId: randomUUID(), ownerId: randomUUID(), documentId: randomUUID(), turnId: randomUUID(),
  authorizationId: randomUUID(), authorizedPoints: 40, decisionHardMaximumPoints: 5, deliveryHardMaximumPoints: 15,
}), phaseId: randomUUID(), policyKey: "search_query",
plannedCall: { inputTokens: 1000, outputTokens: 300, toolCalls: 2, providerAttempts: 1, timeoutMilliseconds: 20_000, maximumResults: 10 },
invoke: async () => ({ value: "invalid", chargedPoints: 1 }) }), /Planned tool calls exceed/u);

console.log("Grant research phases pause before overspend and preserve bounded partial delivery.");

