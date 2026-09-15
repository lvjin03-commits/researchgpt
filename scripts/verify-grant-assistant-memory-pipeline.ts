import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";
import { InMemoryGrantDocumentMemoryRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-document-memory-repository.ts";
import { TiktokenGrantTokenCounter } from "../lib/grants/infrastructure/model/tiktoken-grant-token-counter.ts";
import type { GrantAssistantModel } from "../lib/grants/ports/grant-assistant-model.ts";
import type { GrantAssistantContextPlannerModel } from "../lib/grants/ports/grant-assistant-context-planner-model.ts";
import type { GrantDocumentMemoryModel } from "../lib/grants/ports/grant-document-memory-model.ts";
import type { GrantPatchModel } from "../lib/grants/ports/grant-patch-model.ts";

const documentId = randomUUID();
const revisionId = randomUUID();
const sectionId = randomUUID();
const nodeId = randomUUID();
const snapshot = CanonicalGrantSnapshotSchema.parse({ schemaVersion: "grant-canonical-v1", title: "端到端记忆对话",
  sections: [{ sectionId, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [nodeId] }],
  nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "项目拟解决界面副反应问题。" } }] });

let memoryUnitCalls = 0;
let memorySynthesisCalls = 0;
let plannerCalls = 0;
let answerCalls = 0;
const model: GrantPatchModel & GrantDocumentMemoryModel & GrantAssistantContextPlannerModel & GrantAssistantModel = {
  async generate() { throw new Error("not used"); },
  async analyzeMemoryUnit(input) {
    memoryUnitCalls += 1;
    return { summary: "立项依据提出界面副反应问题。", provider: "openai", modelId: "gpt-offline",
      providerRequestId: "memory-unit", usage: { inputTokens: 10, outputTokens: 3, reasoningTokens: 1 },
      sectionSummaries: [{ sectionAlias: input.allowedSectionAliases[0]!, summary: "提出科学问题。",
        sourceAliases: [input.allowedSourceAliases[0]!] }],
      semanticItems: [{ kind: "scientific_problem", statement: "界面副反应限制性能。", concepts: ["界面副反应"],
        sourceAliases: [input.allowedSourceAliases[0]!] }] };
  },
  async synthesizeMemory(input) {
    memorySynthesisCalls += 1;
    return { overview: "申请书围绕界面副反应展开。", provider: "openai", modelId: "gpt-offline",
      providerRequestId: "memory-synthesis", usage: { inputTokens: 8, outputTokens: 3, reasoningTokens: 1 },
      sectionSummaries: [{ sectionAlias: input.allowedSectionAliases[0]!, summary: "提出并界定科学问题。",
        sourceAliases: [input.allowedSourceAliases[0]!] }],
      semanticItems: [{ kind: "scientific_problem", statement: "界面副反应是核心科学问题。", concepts: ["界面副反应"],
        sourceAliases: [input.allowedSourceAliases[0]!] }] };
  },
  async plan(input) {
    plannerCalls += 1;
    const clarification = input.question.includes("模糊");
    return { answerMode: "explain", documentAccess: clarification ? "memory_only" : "targeted_original",
      diagnosticAccess: "none", webRecommendation: "none",
      targetSectionAliases: clarification ? [] : [input.allowedSectionAliases[0]!],
      targetMemoryItemAliases: clarification ? [] : [input.allowedMemoryItemAliases[0]!],
      needsClarification: clarification, ...(clarification ? { clarificationQuestion: "你希望解释哪一部分？" } : {}),
      confidence: clarification ? 0.4 : 0.93, rationale: clarification ? "目标不明确。" : "需要核对对应原文。",
      provider: "openai", modelId: "gpt-offline", providerRequestId: `planner-${plannerCalls}`,
      usage: { inputTokens: 4, outputTokens: 2, reasoningTokens: 1 } };
  },
  async answerChat(request) {
    answerCalls += 1;
    assert.equal(request.contextPlan?.documentAccess, "targeted_original");
    assert.deepEqual(request.admittedContext.map((source) => source.sourceType), ["document_memory", "original_text"]);
    return { content: "申请书将界面副反应界定为核心科学问题。", provider: "openai", modelId: "gpt-offline",
      providerRequestId: `answer-${answerCalls}`, usage: { inputTokens: 6, outputTokens: 3, reasoningTokens: 1 },
      claims: [{ claimId: "C1", statement: "界面副反应是核心问题。", citationIds: ["X1"] }],
      citations: [{ citationId: "X1", sourceAlias: "O1", excerpt: "项目拟解决界面副反应问题。" }] };
  },
};
const repository = new InMemoryGrantDocumentMemoryRepository();
const gateway = new GrantModelDataGateway(model, undefined, undefined, undefined, new TiktokenGrantTokenCounter());
const base = { documentId, sourceRevisionId: revisionId, snapshot, memoryRepository: repository,
  diagnostics: { async listNormalizedFindings() { return []; } }, expectedModelId: "gpt-offline",
  memoryPolicyVersion: "memory-v1", plannerPolicyVersion: "planner-v1",
  memoryCapacityPolicy: { policyVersion: "memory-capacity-v1", contextWindowTokens: 10_000,
    maximumInputTokens: 8_000, reservedOutputTokens: 1_000, protocolOverheadTokens: 100, safetyMarginTokens: 200 },
  memorySynthesisMaximumInputTokens: 8_000, memoryUnitMaximumOutputTokens: 2_400,
  memorySynthesisMaximumOutputTokens: 3_200, plannerMaximumInputTokens: 8_000,
  answerMaximumInputTokens: 8_000, attemptPurpose: "initial" as const };
const first = await gateway.answerMemoryPlannedAssistantChat({ ...base,
  messages: [{ role: "user", content: "解释这个科学问题为什么成立。" }] });
assert.equal(first.status, "answered");
if (first.status !== "answered") throw new Error("Expected an answered pipeline result.");
assert.equal(first.memoryReused, false);
assert.equal(first.answer.grounding, "evidence_grounded");
assert.equal(first.answer.citations[0]?.sourceType, "original_text");
assert.equal(first.plannedContext.coverage.coveredNodeCount, 1);
assert.deepEqual(first.providerRequestIds, ["memory-unit", "memory-synthesis", "planner-1", "answer-1"]);
assert.deepEqual(first.usage, { inputTokens: 28, outputTokens: 11, reasoningTokens: 4 });

const second = await gateway.answerMemoryPlannedAssistantChat({ ...base,
  messages: [{ role: "user", content: "换一种方式解释这个科学问题。" }] });
assert.equal(second.status, "answered");
assert.equal(second.memoryReused, true);
assert.equal(memoryUnitCalls, 1);
assert.equal(memorySynthesisCalls, 1);
assert.equal(plannerCalls, 2);
assert.equal(answerCalls, 2);
assert.deepEqual(second.providerRequestIds, ["planner-2", "answer-2"]);
assert.deepEqual(second.usage, { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 },
  "Reused memory must not bill its original build usage again.");

const clarification = await gateway.answerMemoryPlannedAssistantChat({ ...base,
  messages: [{ role: "user", content: "这个说法比较模糊。" }] });
assert.equal(clarification.status, "needs_clarification");
assert.equal(clarification.clarificationQuestion, "你希望解释哪一部分？");
assert.equal(answerCalls, 2, "Clarification must stop before answer generation.");

console.log("Grant memory, semantic planning, exact context admission and grounded answering execute as one auditable candidate pipeline.");
