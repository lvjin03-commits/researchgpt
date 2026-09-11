import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AI_OPERATIONS, assertRegisteredAiOperation } from "../lib/ai/operation-registry.ts";
import { getBillingOperationContract, resolveBillingDecision } from "../lib/billing/domain/deliverability.ts";
import { GrantWebGroundedChatBillingPlanSchema, GRANT_WEB_BILLABLE_USAGE, GRANT_WEB_NON_BILLABLE_OUTCOMES } from "../lib/grants/web-sources/billing-contract.ts";
import { GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION, GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION, GRANT_WEB_NEXT_STEP_DECIDE_OPERATION, GRANT_WEB_SOURCE_ASSESS_OPERATION, resolveGrantModelOperationPolicy } from "../lib/grants/model-execution/operation-registry.ts";
import { GRANT_WEB_BUDGET_OPERATION_POLICIES, assertGrantWebPlannedCallWithinPolicy } from "../lib/grants/model-execution/web-budget-operation-policies.ts";

for (const operation of [AI_OPERATIONS.grant.webQueryRewrite, AI_OPERATIONS.grant.webSearchQuery, AI_OPERATIONS.grant.webSourceAssess, AI_OPERATIONS.grant.webAnswerSynthesize, AI_OPERATIONS.grant.webNextStepDecide, AI_OPERATIONS.grant.webExistingResultsDeliver]) {
  assert.equal(assertRegisteredAiOperation(operation), operation);
}
assert.deepEqual(getBillingOperationContract(AI_OPERATIONS.grant.webSearchQuery).bundleKeys, ["search_query"]);
assert.deepEqual(getBillingOperationContract(AI_OPERATIONS.grant.webQueryRewrite).bundleKeys, ["query_rewrite"]);
assert.deepEqual(getBillingOperationContract(AI_OPERATIONS.grant.webSourceAssess).bundleKeys, ["source_assessment"]);
assert.deepEqual(getBillingOperationContract(AI_OPERATIONS.grant.webAnswerSynthesize).bundleKeys, ["grounded_answer"]);
assert.equal(resolveBillingDecision({ operation: AI_OPERATIONS.grant.webSearchQuery, terminalState: GRANT_WEB_NON_BILLABLE_OUTCOMES.no_results }).decision, "release");
assert.equal(resolveBillingDecision({ operation: AI_OPERATIONS.grant.webAnswerSynthesize, terminalState: "delivered" }).decision, "charge_delivered_usage");
assert.deepEqual(GRANT_WEB_BILLABLE_USAGE.search, { kind: "tool_call", tool: "openai_web_search" });

assert.equal(resolveGrantModelOperationPolicy({ operation: GRANT_WEB_SOURCE_ASSESS_OPERATION, configuredGrantModelId: "test-model" }).policyVersion, "grant-web-source-assess-v1");
assert.equal(resolveGrantModelOperationPolicy({ operation: GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION, configuredGrantModelId: "test-model" }).policyVersion, "grant-web-answer-synthesize-v1");
const decisionPolicy = resolveGrantModelOperationPolicy({ operation: GRANT_WEB_NEXT_STEP_DECIDE_OPERATION, configuredGrantModelId: "test-model" });
const deliveryPolicy = resolveGrantModelOperationPolicy({ operation: GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION, configuredGrantModelId: "test-model" });
assert.equal(decisionPolicy.maximumAttempts, 1);
assert.equal(decisionPolicy.executionLimits.maximumToolCalls, 0);
assert.equal(deliveryPolicy.maximumAttempts, 1);
assert.equal(deliveryPolicy.executionLimits.maximumOutputTokens, 1_600);
assert.equal(GRANT_WEB_BUDGET_OPERATION_POLICIES.search_query.maximumToolCalls, 1);
assert.equal(GRANT_WEB_BUDGET_OPERATION_POLICIES.search_query.maximumResults, 10);
assert.equal(GRANT_WEB_BUDGET_OPERATION_POLICIES.existing_results_delivery.envelope, "delivery");
assert.equal(GRANT_WEB_BUDGET_OPERATION_POLICIES.answer_synthesis.envelope, "delivery");
assertGrantWebPlannedCallWithinPolicy({ policy: GRANT_WEB_BUDGET_OPERATION_POLICIES.existing_results_delivery,
  inputTokens: 16_000, outputTokens: 1_600, toolCalls: 0, providerAttempts: 1, timeoutMilliseconds: 90_000 });
assert.throws(() => assertGrantWebPlannedCallWithinPolicy({ policy: GRANT_WEB_BUDGET_OPERATION_POLICIES.existing_results_delivery,
  inputTokens: 16_000, outputTokens: 1_601, toolCalls: 0, providerAttempts: 1, timeoutMilliseconds: 90_000 }), /output exceeds/u);
assert.throws(() => assertGrantWebPlannedCallWithinPolicy({ policy: GRANT_WEB_BUDGET_OPERATION_POLICIES.search_query,
  inputTokens: 2_000, outputTokens: 600, toolCalls: 2, providerAttempts: 1, timeoutMilliseconds: 45_000, maximumResults: 10 }), /tool calls exceed/u);

const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const plan = GrantWebGroundedChatBillingPlanSchema.parse({
  contractVersion: "grant-web-grounded-chat-billing-v1",
  parentOperation: "grant.assistant.chat",
  parentBillingOperationId: ids[0],
  queryRewrite: { operation: "grant.web_query.rewrite", bundleKey: "query_rewrite", billingOperationId: ids[1], pricePolicyVersion: "rewrite-price-v1" },
  search: { operation: "grant.web_search.query", bundleKey: "search_query", billingOperationId: ids[2], pricePolicyVersion: "search-price-v1" },
  assessment: { operation: "grant.web_source.assess", bundleKey: "source_assessment", billingOperationId: ids[3], pricePolicyVersion: "assessment-price-v1" },
  answer: { operation: "grant.web_answer.synthesize", bundleKey: "grounded_answer", billingOperationId: ids[4], pricePolicyVersion: "answer-price-v1" },
});
assert.equal(plan.search.billingOperationId, ids[2]);
assert.throws(() => GrantWebGroundedChatBillingPlanSchema.parse({ ...plan, answer: { ...plan.answer, billingOperationId: ids[2] } }));
assert.throws(() => GrantWebGroundedChatBillingPlanSchema.parse({ ...plan, search: { ...plan.search, operation: "grant.assistant.chat" } }));

console.log("Grant web-search, assessment and grounded-answer Operation/billing contracts verified offline.");
