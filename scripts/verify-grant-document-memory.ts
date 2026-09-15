import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildGrantDocumentMemory } from "../lib/grants/application/grant-document-memory-builder.ts";
import { routeGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-capacity-router.ts";
import { buildGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-context.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";
import { InMemoryGrantDocumentMemoryRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-document-memory-repository.ts";
import { TiktokenGrantTokenCounter } from "../lib/grants/infrastructure/model/tiktoken-grant-token-counter.ts";
import type { GrantDocumentMemoryModel } from "../lib/grants/ports/grant-document-memory-model.ts";

const sectionIds = [randomUUID(), randomUUID()];
const nodeIds = [randomUUID(), randomUUID()];
const documentId = randomUUID();
const snapshot = CanonicalGrantSnapshotSchema.parse({ schemaVersion: "grant-canonical-v1", title: "申请书记忆测试",
  sections: [
    { sectionId: sectionIds[0], semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [nodeIds[0]] },
    { sectionId: sectionIds[1], semanticRole: "plan", title: "研究方案", order: 1, nodeIds: [nodeIds[1]] },
  ], nodes: [
    { nodeId: nodeIds[0], sectionId: sectionIds[0], order: 0, nodeType: "paragraph",
      content: { text: "科学问题是界面副反应，目标是提高循环稳定性。".repeat(240) } },
    { nodeId: nodeIds[1], sectionId: sectionIds[1], order: 0, nodeType: "paragraph",
      content: { text: "采用原位表征验证界面调控机制。".repeat(80) } },
  ] });
const revisionId = randomUUID();
const context = buildGrantFullDocumentContext({ documentId, sourceRevisionId: revisionId, snapshot });
const counter = new TiktokenGrantTokenCounter();
const route = routeGrantFullDocumentContext({ context, tokenCounter: counter, fixedPromptText: "构建申请书记忆",
  policy: { policyVersion: "memory-capacity-v1", contextWindowTokens: 600, maximumInputTokens: 520,
    reservedOutputTokens: 50, protocolOverheadTokens: 10, safetyMarginTokens: 20 } });
assert.equal(route.mode, "hierarchical");

let modelCalls = 0;
let inFlight = 0;
let maximumInFlight = 0;
const model: GrantDocumentMemoryModel = {
  async analyzeMemoryUnit(input) {
    modelCalls += 1;
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    assert.equal(input.attemptPurpose, "initial");
    assert.equal(input.maximumOutputTokens, 2_400);
    return { provider: "openai", modelId: "offline-test-model", providerRequestId: `unit-${input.unitId}`,
      usage: { inputTokens: 10, outputTokens: 4, reasoningTokens: 1 }, summary: `已读 ${input.unitId}`,
      sectionSummaries: input.allowedSectionAliases.map((sectionAlias) => ({ sectionAlias,
        summary: `${sectionAlias} 分块摘要`, sourceAliases: input.allowedSourceAliases.slice(0, 1) })),
      semanticItems: input.allowedSourceAliases.slice(0, 1).map((sourceAlias) => ({
        kind: "research_content" as const, statement: `${input.unitId} 的研究内容`, concepts: ["界面调控"],
        sourceAliases: [sourceAlias] })) };
  },
};
const repository = new InMemoryGrantDocumentMemoryRepository();
const fixedMemoryId = randomUUID();
const memoryExecution = { maximumConcurrentUnitAnalyses: 4, unitMaximumOutputTokens: 2_400,
  attemptPurpose: "initial" as const };
const first = await buildGrantDocumentMemory({ context, route, tokenCounter: counter, model, repository,
  policyVersion: "grant-memory-v1", ...memoryExecution,
  createId: () => fixedMemoryId, now: () => "2026-09-15T12:00:00.000Z" });
assert.equal(first.reused, false);
assert.equal(first.snapshot.memoryId, fixedMemoryId);
assert.equal(first.snapshot.sourceRevisionId, revisionId);
assert.equal(first.snapshot.coverage.complete, true);
assert.equal(first.snapshot.coverage.coveredSectionCount, 2);
assert.equal(first.snapshot.coverage.coveredNodeCount, 2);
assert.deepEqual(first.snapshot.sections.map((section) => section.sectionId), sectionIds);
assert.deepEqual(first.snapshot.sections.flatMap((section) => section.sourceNodeIds), nodeIds);
assert.deepEqual(first.snapshot.items[0]?.sourceNodeIds, [nodeIds[0]]);
assert.deepEqual(first.snapshot.items[0]?.sourceSectionIds, [sectionIds[0]]);
assert.match(first.snapshot.memoryHash, /^[a-f0-9]{64}$/u);
assert.ok(modelCalls > 1, "The oversized document should be fully read in multiple units.");
assert.ok(maximumInFlight > 1, "Independent memory units should run concurrently instead of serially.");

const callsAfterFirstBuild = modelCalls;
const reused = await buildGrantDocumentMemory({ context, route, tokenCounter: counter, model, repository,
  policyVersion: "grant-memory-v1", ...memoryExecution });
assert.equal(reused.reused, true);
assert.equal(reused.snapshot.memoryId, first.snapshot.memoryId);
assert.equal(modelCalls, callsAfterFirstBuild, "An identical Revision and policy must reuse memory without a model call.");

const nextContext = buildGrantFullDocumentContext({ documentId, sourceRevisionId: randomUUID(), snapshot });
const nextRoute = routeGrantFullDocumentContext({ context: nextContext, tokenCounter: counter,
  fixedPromptText: "构建申请书记忆", policy: { policyVersion: "memory-capacity-v1", contextWindowTokens: 600,
    maximumInputTokens: 520, reservedOutputTokens: 50, protocolOverheadTokens: 10, safetyMarginTokens: 20 } });
await buildGrantDocumentMemory({ context: nextContext, route: nextRoute, tokenCounter: counter, model, repository,
  policyVersion: "grant-memory-v1", ...memoryExecution });
assert.ok(modelCalls > callsAfterFirstBuild, "A new canonical Revision must rebuild memory.");

const invalidRepository = new InMemoryGrantDocumentMemoryRepository();
await assert.rejects(() => buildGrantDocumentMemory({ context, route, tokenCounter: counter,
  repository: invalidRepository, policyVersion: "invalid-memory-v1", ...memoryExecution,
  model: { async analyzeMemoryUnit(input) { return { summary: "错误记忆", provider: "openai",
    modelId: "offline-test-model", sectionSummaries: input.allowedSectionAliases.map((sectionAlias) => ({
      sectionAlias, summary: "摘要", sourceAliases: [] })), semanticItems: [{ kind: "other", statement: "错误引用",
      concepts: [], sourceAliases: ["D999"] }] }; } } }), /unavailable grant content/);

console.log("Grant document memory is complete, source-grounded, Revision-bound and reusable without repeat model calls.");
