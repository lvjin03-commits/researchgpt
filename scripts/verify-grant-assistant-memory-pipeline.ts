import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";
import { InMemoryGrantDocumentMemoryRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-document-memory-repository.ts";
import type { GrantAssistantModel } from "../lib/grants/ports/grant-assistant-model.ts";
import type { GrantAssistantContextPlannerModel } from "../lib/grants/ports/grant-assistant-context-planner-model.ts";
import type { GrantDocumentMemoryModel } from "../lib/grants/ports/grant-document-memory-model.ts";
import type { GrantFullDocumentAnalysisModel } from "../lib/grants/ports/grant-full-document-analysis-model.ts";
import type { GrantPatchModel } from "../lib/grants/ports/grant-patch-model.ts";
import { GrantAssistantModelError } from "../lib/grants/ports/grant-assistant-model.ts";
import { createGrantAssistantProviderFailureReason } from "../lib/grants/model-execution/assistant-failure-reasons.ts";
import { GrantNormalizedFindingSchema } from "../lib/grants/diagnostics/normalized-finding.ts";

const documentId = randomUUID();
const revisionId = randomUUID();
const sectionId = randomUUID();
const nodeId = randomUUID();
const snapshot = CanonicalGrantSnapshotSchema.parse({ schemaVersion: "grant-canonical-v1", title: "端到端记忆对话",
  sections: [{ sectionId, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [nodeId] }],
  nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "项目拟解决界面副反应问题。" } }] });
const diagnosticFinding = GrantNormalizedFindingSchema.parse({ findingId: randomUUID(), runId: randomUUID(),
  documentId, sourceRevisionId: revisionId, checkerId: "semantic-review", checkerVersion: "v1",
  contractVersion: null, schemaVersion: "grant-finding-v2", policyVersion: null,
  fingerprint: "f".repeat(64), category: "logic_gap", title: "验证闭环不足",
  diagnosticFact: "验证指标未逐项对应科学问题。", reason: "缺少映射说明。",
  recommendation: "补充指标与科学问题的对应关系。", possibleConsequence: "闭环不清晰。",
  assessment: { scope: "section", confidence: 0.9, actionability: "directly_actionable" },
  sourceAnchor: { sourceRevisionId: revisionId, locationStatus: "located", sectionId, nodeId,
    nodeType: "paragraph", sectionRole: "rationale", heading: "立项依据",
    text: "项目拟解决界面副反应问题。", textHash: "e".repeat(64), previousText: "", nextText: "" },
  relatedLocations: [], affectedArgumentRoles: [], evidenceBasis: null, rootOccurrences: [],
  usedEvidenceCardIds: [], displayOrder: 0, lifecycleStatus: "open", createdAt: "2026-09-15T12:00:00.000Z" });

let memoryUnitCalls = 0;
let plannerCalls = 0;
let answerCalls = 0;
let reviewUnitCalls = 0;
let reviewSynthesisCalls = 0;
let firstAnswerMessageCount = -1;
const model: GrantPatchModel & GrantDocumentMemoryModel & GrantAssistantContextPlannerModel & GrantAssistantModel &
  GrantFullDocumentAnalysisModel = {
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
  async plan(input) {
    plannerCalls += 1;
    if (plannerCalls === 1) assert.equal(input.recentConversation.length, 0,
      "Oversized prior conversation must not displace complete document memory.");
    const clarification = input.question.includes("模糊");
    const fullReview = input.question.includes("全文");
    return { answerMode: fullReview ? "review" : "explain",
      memoryScope: fullReview ? { kind: "all_memory" as const } : { kind: "targets" as const,
        sectionAliases: [input.allowedSectionAliases[0]!], memoryItemAliases: [input.allowedMemoryItemAliases[0]!] },
      documentScope: clarification ? { kind: "memory_only" as const } : fullReview
        ? { kind: "full_original" as const } : { kind: "targeted_original" as const,
          sectionAliases: [input.allowedSectionAliases[0]!], memoryItemAliases: [input.allowedMemoryItemAliases[0]!] },
      diagnosticScope: fullReview ? { kind: "all" as const } : { kind: "none" as const },
      webRecommendation: "none",
      needsClarification: clarification, ...(clarification ? { clarificationQuestion: "你希望解释哪一部分？" } : {}),
      confidence: clarification ? 0.4 : 0.93, rationale: clarification ? "目标不明确。" : "需要核对对应原文。",
      provider: "openai", modelId: "gpt-offline", providerRequestId: `planner-${plannerCalls}`,
      usage: { inputTokens: 4, outputTokens: 2, reasoningTokens: 1 } };
  },
  async analyzeUnit(input) {
    reviewUnitCalls += 1;
    assert.equal(input.maximumOutputTokens, 800);
    return { summary: "本单元说明界面副反应问题。",
      findings: [{ statement: "界面副反应是全文提出的问题。", sourceAliases: [input.allowedSourceAliases[0]!] }],
      provider: "openai", modelId: "gpt-offline", providerRequestId: `review-unit-${reviewUnitCalls}`,
      usage: { inputTokens: 7, outputTokens: 3, reasoningTokens: 1 } };
  },
  async synthesize(input) {
    reviewSynthesisCalls += 1;
    assert.equal(input.maximumOutputTokens, 4_800);
    assert.deepEqual(input.allowedSourceAliases, ["D1", "G1"]);
    assert.equal(input.analyses.at(-1)?.unitId, "CURRENT_DIAGNOSTICS");
    return { content: "全文审查认为科学问题明确，但仍需加强验证闭环。",
      claims: [
        { statement: "申请书以界面副反应为核心问题。", sourceAliases: ["D1"] },
        { statement: "当前诊断指出验证闭环不足。", sourceAliases: ["G1"] },
      ],
      provider: "openai", modelId: "gpt-offline", providerRequestId: `review-synthesis-${reviewSynthesisCalls}`,
      usage: { inputTokens: 9, outputTokens: 4, reasoningTokens: 1 } };
  },
  async answerChat(request) {
    answerCalls += 1;
    if (request.messages.at(-1)?.content.includes("失败")) {
      throw new GrantAssistantModelError("provider_transient_error", "offline failure", {
        providerRequestId: "answer-failed", usage: { inputTokens: 8, outputTokens: 1, reasoningTokens: 0 },
        failureStage: "answer_generation", requestDispatched: true, usageKnown: true,
        failureReason: createGrantAssistantProviderFailureReason({ category: "provider_transient_error",
          stage: "answer_generation", safeFacts: { requestDispatched: true, usageKnown: true } }),
      });
    }
    if (answerCalls === 1) firstAnswerMessageCount = request.messages.length;
    assert.equal(request.contextPlan?.documentAccess, "targeted_original");
    assert.deepEqual(request.admittedContext.map((source) => source.sourceType), ["document_memory", "original_text"]);
    return { content: "申请书将界面副反应界定为核心科学问题。", provider: "openai", modelId: "gpt-offline",
      providerRequestId: `answer-${answerCalls}`, usage: { inputTokens: 6, outputTokens: 3, reasoningTokens: 1 },
      claims: [{ claimId: "C1", statement: "界面副反应是核心问题。", citationIds: ["X1"] }],
      citations: [{ citationId: "X1", sourceAlias: "O1", excerpt: "项目拟解决界面副反应问题。" }] };
  },
};
const repository = new InMemoryGrantDocumentMemoryRepository();
const counter = { tokenizerId: "offline-character-estimator-v1",
  count(text: string) { return Math.max(1, Math.ceil(text.length / 4)); } };
const gateway = new GrantModelDataGateway(model, undefined, undefined, undefined, counter);
const base = { documentId, sourceRevisionId: revisionId, snapshot, memoryRepository: repository,
  diagnostics: { async listNormalizedFindings() { return [diagnosticFinding]; } }, expectedModelId: "gpt-offline",
  memoryPolicyVersion: "memory-v1", plannerPolicyVersion: "planner-v1",
  memoryCapacityPolicy: { policyVersion: "memory-capacity-v1", contextWindowTokens: 10_000,
    maximumInputTokens: 8_000, reservedOutputTokens: 1_000, protocolOverheadTokens: 100, safetyMarginTokens: 200 },
  memoryMaximumConcurrentUnitAnalyses: 4, memoryUnitMaximumOutputTokens: 2_400,
  contextBudgetPolicy: { modelId: "gpt-offline",
    semanticPlanning: { maximumInputTokens: 8_000, maximumOutputTokens: 700 },
    groundedAnswer: { maximumInputTokens: 8_000, maximumOutputTokens: 2_400 },
    fullDocumentReview: { maximumUnitInputTokens: 8_000, maximumUnitOutputTokens: 800,
      maximumSynthesisInputTokens: 8_000, maximumSynthesisOutputTokens: 4_800,
      maximumUnits: 12, maximumSectionsPerUnit: 4 } },
  attemptPurpose: "initial" as const };
const first = await gateway.answerMemoryPlannedAssistantChat({ ...base,
  messages: [{ role: "assistant", content: "冗长历史".repeat(20_000) },
    { role: "user", content: "解释这个科学问题为什么成立。" }] });
assert.equal(first.status, "answered");
if (first.status !== "answered") throw new Error("Expected an answered pipeline result.");
assert.equal(first.memoryReused, false);
assert.equal(first.answer.grounding, "evidence_grounded");
assert.equal(first.answer.citations[0]?.sourceType, "original_text");
assert.equal(firstAnswerMessageCount, 1,
  "Answer stage must preserve current question and omit oversized prior conversation.");
assert.equal(first.plannedContext.coverage.coveredNodeCount, 1);
assert.deepEqual(first.providerRequestIds, ["memory-unit", "planner-1", "answer-1"]);
assert.deepEqual(first.usage, { inputTokens: 20, outputTokens: 8, reasoningTokens: 3 });
assert.deepEqual(first.contextManifests.map((manifest) => manifest.stage),
  ["semantic_planning", "grounded_answer"]);
assert.equal(first.contextManifests[0]?.status, "context_adapted");

const second = await gateway.answerMemoryPlannedAssistantChat({ ...base,
  messages: [{ role: "user", content: "换一种方式解释这个科学问题。" }] });
assert.equal(second.status, "answered");
assert.equal(second.memoryReused, true);
assert.equal(memoryUnitCalls, 1);
assert.equal(plannerCalls, 2);
assert.equal(answerCalls, 2);
assert.deepEqual(second.providerRequestIds, ["planner-2", "answer-2"]);
assert.deepEqual(second.usage, { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 },
  "Reused memory must not bill its original build usage again.");

const fullReview = await gateway.answerMemoryPlannedAssistantChat({ ...base,
  messages: [{ role: "user", content: "基于全文审查有哪些需要完善的地方？" }] });
assert.equal(fullReview.status, "answered");
if (fullReview.status !== "answered") throw new Error("Expected a hierarchical full-document answer.");
assert.equal(fullReview.executionMode, "hierarchical_full_review");
assert.equal(answerCalls, 2, "Full review must not fall back to the single answerChat request.");
assert.equal(reviewUnitCalls, 1);
assert.equal(reviewSynthesisCalls, 1);
assert.deepEqual(fullReview.contextManifests.map((manifest) => manifest.stage),
  ["semantic_planning", "full_review_unit", "full_review_synthesis"]);
assert.deepEqual(fullReview.providerRequestIds,
  ["planner-3", "review-unit-1", "review-synthesis-1"]);
assert.equal(fullReview.answer.citations[0]?.sourceType, "original_text");
assert.equal(fullReview.answer.citations[1]?.sourceType, "diagnostic");
assert.equal(fullReview.plannedContext.sources.some((source) => source.sourceType === "original_text"), false,
  "The planned single-request context must not contain the complete original document.");

const clarification = await gateway.answerMemoryPlannedAssistantChat({ ...base,
  messages: [{ role: "user", content: "这个说法比较模糊。" }] });
assert.equal(clarification.status, "needs_clarification");
assert.equal(clarification.clarificationQuestion, "你希望解释哪一部分？");
assert.equal(answerCalls, 2, "Clarification must stop before answer generation.");

await assert.rejects(
  gateway.answerMemoryPlannedAssistantChat({ ...base,
    messages: [{ role: "user", content: "让回答失败以验证审计信息。" }] }),
  (error: unknown) => {
    assert.ok(error instanceof GrantAssistantModelError);
    assert.equal(error.failureStage, "answer_generation");
    assert.deepEqual(error.providerRequestIds, ["planner-5", "answer-failed"]);
    assert.deepEqual(error.usage, { inputTokens: 20, outputTokens: 4, reasoningTokens: 1 });
    assert.equal(error.failureReason?.reasonCode, "provider.transient_error");
    return true;
  },
  "A later-stage failure must retain the usage and request IDs of earlier successful stages.",
);

const partialGateway = new GrantModelDataGateway({ ...model,
  async synthesize() {
    throw new GrantAssistantModelError("provider_unavailable", "offline synthesis outage", {
      providerRequestId: "review-synthesis-unavailable",
      usage: { inputTokens: 9, outputTokens: 0, reasoningTokens: 0 },
      failureStage: "answer_generation", requestDispatched: true, usageKnown: true,
      failureReason: createGrantAssistantProviderFailureReason({ category: "provider_unavailable",
        stage: "answer_generation", safeFacts: { requestDispatched: true, usageKnown: true } }),
    });
  },
}, undefined, undefined, undefined, counter);
const partial = await partialGateway.answerMemoryPlannedAssistantChat({ ...base,
  messages: [{ role: "user", content: "基于全文审查有哪些需要完善的地方？" }] });
assert.equal(partial.status, "answered");
if (partial.status !== "answered") throw new Error("Expected a truthful partial full-document answer.");
assert.equal(partial.executionMode, "hierarchical_full_review");
assert.equal(partial.reviewCoverage?.complete, false);
assert.equal(partial.reviewCoverage?.synthesisComplete, false);
assert.equal(partial.reviewCoverage?.coveredUnitCount, 1);
assert.equal(partial.reviewCoverage?.totalUnitCount, 1);
assert.equal(partial.reviewCoverage?.partialReasonCode, "provider.unavailable");
assert.match(partial.answer.content, /部分分析/u);
assert.ok(partial.providerRequestIds.includes("review-synthesis-unavailable"));
assert.deepEqual(partial.usage, { inputTokens: 20, outputTokens: 5, reasoningTokens: 2 },
  "Partial delivery must retain the planner, completed-unit and failed-synthesis usage actually incurred.");

console.log("Grant memory, semantic planning, exact context admission and grounded answering execute as one auditable candidate pipeline.");
