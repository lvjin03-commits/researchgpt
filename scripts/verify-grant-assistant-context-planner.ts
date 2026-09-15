import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { planGrantAssistantContext } from "../lib/grants/application/grant-assistant-context-planner.ts";
import { GrantDocumentMemorySnapshotSchema } from "../lib/grants/assistant/document-memory-contracts.ts";
import { TiktokenGrantTokenCounter } from "../lib/grants/infrastructure/model/tiktoken-grant-token-counter.ts";
import type { GrantAssistantContextPlannerModel } from "../lib/grants/ports/grant-assistant-context-planner-model.ts";

const documentId = randomUUID();
const revisionId = randomUUID();
const sectionIds = [randomUUID(), randomUUID()];
const nodeIds = [randomUUID(), randomUUID()];
const memory = GrantDocumentMemorySnapshotSchema.parse({ schemaVersion: "grant-document-memory-v1",
  memoryId: randomUUID(), documentId, sourceRevisionId: revisionId, contextHash: "a".repeat(64),
  memoryHash: "b".repeat(64), policyVersion: "grant-memory-v1", provider: "openai",
  modelId: "offline-memory-model", builtAt: "2026-09-15T12:00:00.000Z",
  overview: "项目研究水系锌电池界面调控。", sections: [
    { sectionId: sectionIds[0], title: "立项依据", semanticRole: "rationale", summary: "提出界面副反应问题。",
      sourceNodeIds: [nodeIds[0]] },
    { sectionId: sectionIds[1], title: "研究方案", semanticRole: "plan", summary: "采用原位表征验证机制。",
      sourceNodeIds: [nodeIds[1]] },
  ], items: [
    { memoryItemId: "M1", kind: "scientific_problem", statement: "界面副反应限制循环稳定性。",
      concepts: ["界面副反应"], sourceSectionIds: [sectionIds[0]], sourceNodeIds: [nodeIds[0]] },
    { memoryItemId: "M2", kind: "technical_route", statement: "通过原位表征核对调控机制。",
      concepts: ["原位表征"], sourceSectionIds: [sectionIds[1]], sourceNodeIds: [nodeIds[1]] },
  ], coverage: { sectionCount: 2, nodeCount: 2, coveredSectionCount: 2, coveredNodeCount: 2, complete: true },
  usage: { inputTokens: 100, outputTokens: 30, reasoningTokens: 5 }, providerRequestIds: ["memory-request"] });
const counter = new TiktokenGrantTokenCounter();
let receivedQuestion = "";
let receivedExplicitWeb = false;
const model: GrantAssistantContextPlannerModel = {
  async plan(input) {
    receivedQuestion = input.question;
    receivedExplicitWeb = input.explicitContext.webSearchEnabledByUser;
    assert.match(input.documentMemoryText, /全文记忆概览/u);
    assert.match(input.documentMemoryText, /\[S2\] 研究方案/u);
    assert.match(input.documentMemoryText, /\[M2\] technical_route/u);
    return { answerMode: "explain", documentAccess: "targeted_original", diagnosticAccess: "relevant",
      webRecommendation: "recommended", targetSectionAliases: ["S2"], targetMemoryItemAliases: ["M2"],
      needsClarification: false, confidence: 0.91, rationale: "需要核对方案原文并结合相关诊断。",
      provider: "openai", modelId: "offline-planner-model", providerRequestId: "planner-request",
      usage: { inputTokens: 42, outputTokens: 11, reasoningTokens: 3 } };
  },
};
const plan = await planGrantAssistantContext({ documentId, sourceRevisionId: revisionId,
  question: "把这里为什么这样安排讲透", recentConversation: [{ role: "assistant", content: "上一轮讨论了验证方案。" }],
  memory, model, tokenCounter: counter, maximumInputTokens: 8_000, plannerPolicyVersion: "grant-context-planner-v1",
  explicitContext: { webSearchEnabledByUser: false }, createId: () => "77777777-7777-4777-8777-777777777777" });
assert.equal(receivedQuestion, "把这里为什么这样安排讲透");
assert.equal(receivedExplicitWeb, false);
assert.equal(plan.documentAccess, "targeted_original");
assert.equal(plan.diagnosticAccess, "relevant");
assert.equal(plan.webRecommendation, "recommended", "The model may recommend web search but cannot authorize it.");
assert.deepEqual(plan.targetSectionIds, [sectionIds[1]]);
assert.deepEqual(plan.targetMemoryItemIds, ["M2"]);
assert.match(plan.planHash, /^[a-f0-9]{64}$/u);

await assert.rejects(() => planGrantAssistantContext({ documentId, sourceRevisionId: randomUUID(),
  question: "任意问题", recentConversation: [], memory, model, tokenCounter: counter,
  maximumInputTokens: 8_000, plannerPolicyVersion: "grant-context-planner-v1" }), /current canonical Revision/);

await assert.rejects(() => planGrantAssistantContext({ documentId, sourceRevisionId: revisionId,
  question: "任意问题", recentConversation: [], memory, tokenCounter: counter, maximumInputTokens: 8_000,
  plannerPolicyVersion: "grant-context-planner-v1", model: { async plan() { return {
    answerMode: "answer", documentAccess: "targeted_original", diagnosticAccess: "none", webRecommendation: "none",
    targetSectionAliases: ["S99"], targetMemoryItemAliases: [], needsClarification: false, confidence: 0.8,
    rationale: "错误目标", provider: "openai", modelId: "offline-planner-model" }; } } }), /unavailable memory target/);

await assert.rejects(() => planGrantAssistantContext({ documentId, sourceRevisionId: revisionId,
  question: "任意问题", recentConversation: [], memory, model, tokenCounter: counter,
  maximumInputTokens: 1, plannerPolicyVersion: "grant-context-planner-v1" }), /does not fit/);

console.log("Grant context planning is semantic, memory-first, Revision-bound and cannot authorize web access.");
