import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AI_OPERATIONS, REGISTERED_AI_OPERATIONS, assertRegisteredAiOperation, operationForChatTaskKind } from "../lib/ai/operation-registry.ts";
import { AiUsageEnvelopeSchema, StandardizedBillableUsageSchema, tokenUsage } from "../lib/ai/billable-usage.ts";
import { GRANT_EDIT_SESSION_NON_BILLABLE_ACTIONS, GrantEditTurnBillingBundleSchema, createGrantEditTurnBillingBundle } from "../lib/grants/edit-session/billing-contract.ts";
import { GRANT_ASSISTANT_CHAT_OPERATION, GRANT_EDIT_SESSION_TURN_OPERATION } from "../lib/grants/model-execution/operation-registry.ts";

assert.equal(new Set(REGISTERED_AI_OPERATIONS).size, REGISTERED_AI_OPERATIONS.length, "registered operation IDs must be unique");
for (const operation of REGISTERED_AI_OPERATIONS) assert.equal(assertRegisteredAiOperation(operation), operation);
assert.throws(() => assertRegisteredAiOperation("grant.unregistered.operation"));
assert.equal(GRANT_ASSISTANT_CHAT_OPERATION, AI_OPERATIONS.grant.assistantChat);
assert.equal(GRANT_EDIT_SESSION_TURN_OPERATION, AI_OPERATIONS.grant.editSessionTurn);
assert.deepEqual([
  operationForChatTaskKind("conversation"), operationForChatTaskKind("web_research"),
  operationForChatTaskKind("file_analysis"), operationForChatTaskKind("data_analysis"),
  operationForChatTaskKind("visualization"), operationForChatTaskKind("artifact"),
], Object.values(AI_OPERATIONS.chat));

const token = tokenUsage({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, reasoningTokens: 10 });
for (const usage of [token, { kind: "tool_call", tool: "web_search", count: 2 },
  { kind: "image_input", units: 3, detail: "high" },
  { kind: "image_generation", count: 1, size: "1024x1024", quality: "high" },
  { kind: "audio", durationMilliseconds: 12_000 },
  { kind: "video", durationMilliseconds: 5_000, resolution: "1080p" }]) {
  assert.equal(StandardizedBillableUsageSchema.safeParse(usage).success, true);
}
assert.equal(StandardizedBillableUsageSchema.safeParse({ kind: "tokens", inputTokens: 10, cachedInputTokens: 11, outputTokens: 0, reasoningTokens: 0 }).success, false);
assert.equal(StandardizedBillableUsageSchema.safeParse({ kind: "tokens", inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 6 }).success, false);
assert.equal(StandardizedBillableUsageSchema.safeParse({ kind: "audio", durationMilliseconds: -1 }).success, false);
assert.equal(StandardizedBillableUsageSchema.safeParse({ kind: "storage", bytes: 10 }).success, false);

const operationId = randomUUID();
assert.equal(AiUsageEnvelopeSchema.parse({
  usageEventId: randomUUID(), billingOperationId: operationId,
  operation: AI_OPERATIONS.chat.webResearch, provider: "openai", modelId: "test-model",
  attemptNumber: 1, cacheHit: false,
  usage: [token, { kind: "tool_call", tool: "web_search", count: 1 }],
  occurredAt: "2026-08-22T12:00:00.000Z",
}).billingOperationId, operationId);

const editSessionId = randomUUID();
const turnId = randomUUID();
const bundle = createGrantEditTurnBillingBundle({ editSessionId, turnId, pricePolicyVersion: "price-v1" });
assert.equal(bundle.billingOperationId, turnId);
assert.equal(bundle.operation, AI_OPERATIONS.grant.editSessionTurn);
assert.equal(GrantEditTurnBillingBundleSchema.safeParse({ ...bundle, billingOperationId: randomUUID() }).success, false);
assert.ok(GRANT_EDIT_SESSION_NON_BILLABLE_ACTIONS.includes("candidate.apply"));
assert.ok(GRANT_EDIT_SESSION_NON_BILLABLE_ACTIONS.includes("session.create"));

const documentContracts = await readFile(new URL("../lib/document-v2-production/structured-operation-contracts.ts", import.meta.url), "utf8");
const documentAdapter = await readFile(new URL("../lib/document-v2-production/openai-adapters.ts", import.meta.url), "utf8");
const grantRegistry = await readFile(new URL("../lib/grants/model-execution/operation-registry.ts", import.meta.url), "utf8");
assert.ok(documentContracts.includes("AI_OPERATIONS.document.requestUnderstand"));
assert.ok(documentContracts.includes("AI_OPERATIONS.document.outlineSectionPlan"));
assert.ok(documentAdapter.includes("AI_OPERATIONS.document.componentGenerate"));
assert.ok(grantRegistry.includes("AI_OPERATIONS.grant.editSessionTurn"));
assert.ok(grantRegistry.includes("AI_OPERATIONS.grant.assistantChat"));

console.log("Shared AI Operation Registry, standardized usage and Edit Turn billing contracts passed.");
