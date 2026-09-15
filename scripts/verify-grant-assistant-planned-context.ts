import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assembleGrantAssistantPlannedContext } from "../lib/grants/application/grant-assistant-planned-context.ts";
import { GrantAssistantContextPlanSchema } from "../lib/grants/assistant/context-plan-contracts.ts";
import { GrantDocumentMemorySnapshotSchema } from "../lib/grants/assistant/document-memory-contracts.ts";
import { GrantNormalizedFindingSchema } from "../lib/grants/diagnostics/normalized-finding.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";

const documentId = randomUUID();
const revisionId = randomUUID();
const sectionIds = [randomUUID(), randomUUID(), randomUUID()];
const nodeIds = [randomUUID(), randomUUID(), randomUUID()];
const snapshot = CanonicalGrantSnapshotSchema.parse({ schemaVersion: "grant-canonical-v1", title: "计划上下文测试",
  sections: [
    { sectionId: sectionIds[0], semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [nodeIds[0]] },
    { sectionId: sectionIds[1], semanticRole: "plan", title: "研究方案", order: 1, nodeIds: [nodeIds[1]] },
    { sectionId: sectionIds[2], parentSectionId: sectionIds[1], semanticRole: "method", title: "验证方法", order: 0, nodeIds: [nodeIds[2]] },
  ], nodes: [
    { nodeId: nodeIds[0], sectionId: sectionIds[0], order: 0, nodeType: "paragraph", content: { text: "提出科学问题。" } },
    { nodeId: nodeIds[1], sectionId: sectionIds[1], order: 0, nodeType: "paragraph", content: { text: "给出总体研究方案。" } },
    { nodeId: nodeIds[2], sectionId: sectionIds[2], order: 0, nodeType: "paragraph", content: { text: "使用原位表征验证机制。" } },
  ] });
const memory = GrantDocumentMemorySnapshotSchema.parse({ schemaVersion: "grant-document-memory-v1",
  memoryId: randomUUID(), documentId, sourceRevisionId: revisionId, contextHash: "a".repeat(64),
  memoryHash: "b".repeat(64), policyVersion: "grant-memory-v1", provider: "openai", modelId: "offline-model",
  builtAt: "2026-09-15T12:00:00.000Z", overview: "项目围绕科学问题和验证方案展开。",
  sections: snapshot.sections.map((section, index) => ({ sectionId: section.sectionId, title: section.title,
    semanticRole: section.semanticRole, summary: `${section.title}摘要`, sourceNodeIds: [nodeIds[index]!] })),
  items: [{ memoryItemId: "M1", kind: "technical_route", statement: "通过原位表征验证机制。",
    concepts: ["原位表征"], sourceSectionIds: [sectionIds[2]], sourceNodeIds: [nodeIds[2]] }],
  coverage: { sectionCount: 3, nodeCount: 3, coveredSectionCount: 3, coveredNodeCount: 3, complete: true },
  usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 1 }, providerRequestIds: ["memory"] });

function plan(overrides: Partial<Parameters<typeof GrantAssistantContextPlanSchema.parse>[0]> = {}) {
  return GrantAssistantContextPlanSchema.parse({ schemaVersion: "grant-assistant-context-plan-v1",
    planId: randomUUID(), planHash: "c".repeat(64), documentId, sourceRevisionId: revisionId,
    memoryId: memory.memoryId, memoryHash: memory.memoryHash, plannerPolicyVersion: "planner-v1",
    answerMode: "explain", documentAccess: "targeted_original", diagnosticAccess: "relevant",
    webRecommendation: "none", targetSectionIds: [sectionIds[1]], targetMemoryItemIds: ["M1"],
    needsClarification: false, confidence: 0.9, rationale: "核对研究方案及其验证方法。",
    provider: "openai", modelId: "offline-planner", usage: { inputTokens: 2, outputTokens: 1, reasoningTokens: 0 },
    ...overrides });
}

function finding(input: { sourceRevisionId?: string; sectionId?: string; nodeId?: string;
  lifecycleStatus?: "open" | "closed" | "superseded"; invalidAnchor?: boolean }) {
  const sourceRevisionId = input.sourceRevisionId ?? revisionId;
  const sectionId = input.sectionId ?? sectionIds[2]!;
  const nodeId = input.nodeId ?? nodeIds[2]!;
  return GrantNormalizedFindingSchema.parse({ findingId: randomUUID(), runId: randomUUID(), documentId,
    sourceRevisionId, checkerId: "semantic-review", checkerVersion: "v1", contractVersion: null,
    schemaVersion: "grant-finding-v2", policyVersion: null, fingerprint: "d".repeat(64), category: "logic_gap",
    title: "验证链条不足", diagnosticFact: "验证指标未与科学问题逐项对应。", reason: "缺少映射说明。",
    recommendation: "补充指标与科学问题的对应关系。", possibleConsequence: "评审者难以判断闭环。",
    assessment: { scope: "section", confidence: 0.88, actionability: "directly_actionable" },
    sourceAnchor: { sourceRevisionId, locationStatus: "located", sectionId,
      nodeId: input.invalidAnchor ? randomUUID() : nodeId, nodeType: "paragraph", sectionRole: "method",
      heading: "验证方法", text: "使用原位表征验证机制。", textHash: "e".repeat(64), previousText: "", nextText: "" },
    relatedLocations: [], affectedArgumentRoles: [], evidenceBasis: null, rootOccurrences: [], usedEvidenceCardIds: [],
    displayOrder: 0, lifecycleStatus: input.lifecycleStatus ?? "open", createdAt: "2026-09-15T12:00:00.000Z" });
}

const currentRelevant = finding({});
const currentUnrelated = finding({ sectionId: sectionIds[0], nodeId: nodeIds[0] });
const oldFinding = finding({ sourceRevisionId: randomUUID() });
const closedFinding = finding({ lifecycleStatus: "closed" });
const diagnostics = { async listNormalizedFindings() { return [currentRelevant, currentUnrelated, oldFinding, closedFinding]; } };
const targeted = await assembleGrantAssistantPlannedContext({ documentId, sourceRevisionId: revisionId,
  snapshot, memory, plan: plan(), diagnostics });
assert.deepEqual(targeted.sources.map((source) => source.sourceType),
  ["document_memory", "original_text", "original_text", "diagnostic"]);
assert.deepEqual(targeted.sources.filter((source) => source.sourceType === "original_text").map((source) => source.nodeId),
  [nodeIds[1], nodeIds[2]], "Selecting a parent section must include its canonical descendants.");
assert.equal(targeted.sources.at(-1)?.findingId, currentRelevant.findingId);
assert.equal(targeted.coverage.coveredSectionCount, 2);
assert.equal(targeted.coverage.coveredNodeCount, 2);
assert.equal(targeted.coverage.availableCurrentFindingCount, 2);
assert.equal(targeted.coverage.admittedFindingCount, 1);
assert.equal(targeted.coverage.completeOriginal, false);

const memoryOnly = await assembleGrantAssistantPlannedContext({ documentId, sourceRevisionId: revisionId,
  snapshot, memory, plan: plan({ documentAccess: "memory_only", diagnosticAccess: "none",
    targetSectionIds: [], targetMemoryItemIds: [] }), diagnostics });
assert.deepEqual(memoryOnly.sources.map((source) => source.sourceType), ["document_memory"]);
assert.equal(memoryOnly.coverage.coveredNodeCount, 0);

const complete = await assembleGrantAssistantPlannedContext({ documentId, sourceRevisionId: revisionId,
  snapshot, memory, plan: plan({ documentAccess: "full_original", diagnosticAccess: "all",
    targetSectionIds: [], targetMemoryItemIds: [] }), diagnostics });
assert.equal(complete.coverage.completeOriginal, true);
assert.equal(complete.coverage.coveredSectionCount, 3);
assert.equal(complete.coverage.coveredNodeCount, 3);
assert.equal(complete.coverage.admittedFindingCount, 2);
assert.equal(complete.sources.filter((source) => source.sourceType === "original_text").length, 3);

await assert.rejects(() => assembleGrantAssistantPlannedContext({ documentId, sourceRevisionId: revisionId,
  snapshot, memory, plan: plan(), diagnostics: { async listNormalizedFindings() { return [finding({ invalidAnchor: true })]; } } }),
  /outside the canonical Revision/);

console.log("Grant planned context reads exact current original text and current diagnostic Findings without stale leakage.");
