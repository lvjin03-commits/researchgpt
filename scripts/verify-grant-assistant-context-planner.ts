import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { planGrantAssistantContext } from "../lib/grants/application/grant-assistant-context-planner.ts";
import { GrantDocumentMemorySnapshotSchema } from "../lib/grants/assistant/document-memory-contracts.ts";
import type { GrantAssistantContextPlannerModel } from "../lib/grants/ports/grant-assistant-context-planner-model.ts";

const documentId = randomUUID();
const revisionId = randomUUID();
const sectionIds = [randomUUID(), randomUUID()];
const nodeIds = [randomUUID(), randomUUID()];
const memory = GrantDocumentMemorySnapshotSchema.parse({ schemaVersion: "grant-document-memory-v2",
  memoryId: randomUUID(), documentId, sourceRevisionId: revisionId, contextHash: "a".repeat(64),
  memoryHash: "b".repeat(64), policyVersion: "grant-memory-v1", provider: "openai",
  modelId: "offline-memory-model", builtAt: "2026-09-15T12:00:00.000Z",
  l0: { overview: "项目研究水系锌电池界面调控。", itemIdsByKind: {
    scientific_problem: ["M1"], research_objective: [], research_content: [], technical_route: ["M2"],
    innovation: [], preliminary_basis: [], feasibility: [], risk: [], constraint: [], other: [],
  } }, l1: { sections: [
    { sectionId: sectionIds[0], parentSectionId: null, title: "立项依据", semanticRole: "rationale", summary: "提出界面副反应问题。",
    },
    { sectionId: sectionIds[1], parentSectionId: null, title: "研究方案", semanticRole: "plan", summary: "采用原位表征验证机制。",
    },
  ], items: [
    { memoryItemId: "M1", kind: "scientific_problem", statement: "界面副反应限制循环稳定性。",
      concepts: ["界面副反应"], sourceSectionIds: [sectionIds[0]] },
    { memoryItemId: "M2", kind: "technical_route", statement: "通过原位表征核对调控机制。",
      concepts: ["原位表征"], sourceSectionIds: [sectionIds[1]] },
  ] }, l2: { sectionAnchors: [
    { sectionId: sectionIds[0], sourceNodeIds: [nodeIds[0]] },
    { sectionId: sectionIds[1], sourceNodeIds: [nodeIds[1]] },
  ], itemAnchors: [
    { memoryItemId: "M1", sourceNodeIds: [nodeIds[0]] },
    { memoryItemId: "M2", sourceNodeIds: [nodeIds[1]] },
  ] }, coverage: { sectionCount: 2, nodeCount: 2, coveredSectionCount: 2, coveredNodeCount: 2, complete: true },
  usage: { inputTokens: 100, outputTokens: 30, reasoningTokens: 5 }, providerRequestIds: ["memory-request"] });
const counter = { tokenizerId: "offline-character-estimator-v1",
  count(text: string) { return Math.max(1, Math.ceil(text.length / 4)); } };
const contextBudgetPolicy = { modelId: "offline-planner-model",
  semanticPlanning: { maximumInputTokens: 8_000, maximumOutputTokens: 700 },
  groundedAnswer: { maximumInputTokens: 8_000, maximumOutputTokens: 2_400 } };
let receivedQuestion = "";
let receivedExplicitWeb = false;
let receivedRecentConversationCount = -1;
const model: GrantAssistantContextPlannerModel = {
  async plan(input) {
    receivedQuestion = input.question;
    receivedExplicitWeb = input.explicitContext.webSearchEnabledByUser;
    receivedRecentConversationCount = input.recentConversation.length;
    assert.match(input.documentMemoryText, /L0 全文认知/u);
    assert.match(input.documentMemoryText, /\[S2\] 研究方案/u);
    assert.match(input.documentMemoryText, /\[M2\] technical_route/u);
    assert.ok(nodeIds.every((nodeId) => !input.documentMemoryText.includes(nodeId)),
      "Planner must receive the compact L0/L1 index without L2 canonical node references.");
    return { answerMode: "explain", documentAccess: "targeted_original", diagnosticAccess: "relevant",
      webRecommendation: "recommended", targetSectionAliases: ["S2"], targetMemoryItemAliases: ["M2"],
      needsClarification: false, confidence: 0.91, rationale: "需要核对方案原文并结合相关诊断。",
      provider: "openai", modelId: "offline-planner-model", providerRequestId: "planner-request",
      usage: { inputTokens: 42, outputTokens: 11, reasoningTokens: 3 } };
  },
};
const plan = await planGrantAssistantContext({ documentId, sourceRevisionId: revisionId,
  question: "把这里为什么这样安排讲透", recentConversation: [{ role: "assistant", content: "上一轮讨论了验证方案。" }],
  memory, model, tokenCounter: counter, contextBudgetPolicy, plannerPolicyVersion: "grant-context-planner-v1",
  explicitContext: { webSearchEnabledByUser: false }, createId: () => "77777777-7777-4777-8777-777777777777" });
assert.equal(receivedQuestion, "把这里为什么这样安排讲透");
assert.equal(receivedExplicitWeb, false);
assert.equal(receivedRecentConversationCount, 1);
assert.equal(plan.documentAccess, "targeted_original");
assert.equal(plan.diagnosticAccess, "relevant");
assert.equal(plan.webRecommendation, "recommended", "The model may recommend web search but cannot authorize it.");
assert.deepEqual(plan.targetSectionIds, [sectionIds[1]]);
assert.deepEqual(plan.targetMemoryItemIds, ["M2"]);
assert.match(plan.planHash, /^[a-f0-9]{64}$/u);
assert.equal(plan.contextManifest.stage, "semantic_planning");
assert.equal(plan.contextManifest.reservedOutputTokens, 700);
assert.match(plan.contextManifest.payloadHash, /^[a-f0-9]{64}$/u);

await assert.rejects(() => planGrantAssistantContext({ documentId, sourceRevisionId: randomUUID(),
  question: "任意问题", recentConversation: [], memory, model, tokenCounter: counter,
  contextBudgetPolicy, plannerPolicyVersion: "grant-context-planner-v1" }), /current canonical Revision/);

await assert.rejects(() => planGrantAssistantContext({ documentId, sourceRevisionId: revisionId,
  question: "任意问题", recentConversation: [], memory, tokenCounter: counter, contextBudgetPolicy,
  plannerPolicyVersion: "grant-context-planner-v1", model: { async plan() { return {
    answerMode: "answer", documentAccess: "targeted_original", diagnosticAccess: "none", webRecommendation: "none",
    targetSectionAliases: ["S99"], targetMemoryItemAliases: [], needsClarification: false, confidence: 0.8,
    rationale: "错误目标", provider: "openai", modelId: "offline-planner-model" }; } } }), /unavailable memory target/);

await planGrantAssistantContext({ documentId, sourceRevisionId: revisionId,
  question: "基于全文给出改进建议", recentConversation: [{ role: "assistant", content: "冗长历史".repeat(20_000) }],
  memory, model, tokenCounter: counter, contextBudgetPolicy,
  plannerPolicyVersion: "grant-context-planner-v1" });
assert.equal(receivedRecentConversationCount, 0,
  "Planner must preserve complete document memory and omit oversized prior conversation.");

await assert.rejects(() => planGrantAssistantContext({ documentId, sourceRevisionId: revisionId,
  question: "任意问题", recentConversation: [], memory, model, tokenCounter: counter,
  contextBudgetPolicy: { ...contextBudgetPolicy,
    semanticPlanning: { ...contextBudgetPolicy.semanticPlanning, maximumInputTokens: 1 } },
  plannerPolicyVersion: "grant-context-planner-v1" }), /does not fit/);

console.log("Grant context planning is semantic, memory-first, Revision-bound and cannot authorize web access.");
