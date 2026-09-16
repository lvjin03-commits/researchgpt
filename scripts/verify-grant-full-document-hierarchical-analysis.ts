import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeGrantFullDocumentHierarchicalAnalysis } from "../lib/grants/application/grant-full-document-hierarchical-analysis.ts";
import { routeGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-capacity-router.ts";
import { buildGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-context.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";
import { TiktokenGrantTokenCounter } from "../lib/grants/infrastructure/model/tiktoken-grant-token-counter.ts";
import type { GrantFullDocumentAnalysisModel } from "../lib/grants/ports/grant-full-document-analysis-model.ts";
import { GrantAssistantModelError } from "../lib/grants/ports/grant-assistant-model.ts";
import { createGrantAssistantProviderFailureReason } from "../lib/grants/model-execution/assistant-failure-reasons.ts";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";


const firstSectionId = randomUUID();
const secondSectionId = randomUUID();
const longNodeId = randomUUID();
const shortNodeId = randomUUID();
const snapshot = CanonicalGrantSnapshotSchema.parse({ schemaVersion: "grant-canonical-v1", title: "全文分析测试",
    sections: [
      { sectionId: firstSectionId, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [longNodeId] },
      { sectionId: secondSectionId, semanticRole: "plan", title: "研究方案", order: 1, nodeIds: [shortNodeId] },
    ], nodes: [
      { nodeId: longNodeId, sectionId: firstSectionId, order: 0, nodeType: "paragraph", content: { text: "长段落科学问题与研究依据。".repeat(400) } },
      { nodeId: shortNodeId, sectionId: secondSectionId, order: 0, nodeType: "paragraph", content: { text: "研究方案正文。".repeat(20) } },
    ] });
const context = buildGrantFullDocumentContext({ documentId: randomUUID(), sourceRevisionId: randomUUID(), snapshot });
const tokenCounter = new TiktokenGrantTokenCounter();
const route = routeGrantFullDocumentContext({ context, tokenCounter, fixedPromptText: "分析问题",
  policy: { policyVersion: "hierarchical-test-v1", contextWindowTokens: 500, maximumInputTokens: 420,
    reservedOutputTokens: 50, protocolOverheadTokens: 10, safetyMarginTokens: 20 } });
assert.equal(route.mode, "hierarchical");
if (route.mode !== "hierarchical") throw new Error("Expected hierarchical route.");

const analyzedUnitIds: string[] = [];
const model: GrantFullDocumentAnalysisModel = {
  async analyzeUnit(input) {
    assert.equal(input.maximumOutputTokens, 800);
    analyzedUnitIds.push(input.unitId);
    return { summary: `已分析 ${input.unitId}`, provider: "openai", modelId: "test-model",
      findings: input.allowedSourceAliases.length > 0
        ? [{ statement: "分块结论", sourceAliases: [input.allowedSourceAliases[0]!] }] : [] };
  },
  async synthesize(input) {
    assert.equal(input.maximumOutputTokens, 2_400);
    return { content: "完整申请书综合分析", provider: "openai", modelId: "test-model", claims: [{ statement: "全文结论",
      sourceAliases: [...new Set(input.analyses.flatMap((analysis) =>
        analysis.findings.flatMap((finding) => finding.sourceAliases)))] }] };
  },
};
let admittedUnitCount = 0;
let synthesisAdmitted = false;
const result = await executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter, model,
  question: "评价整篇申请书", unitMaximumOutputTokens: 800,
  synthesisMaximumInputTokens: 10_000, synthesisMaximumOutputTokens: 2_400, maximumUnits: 20,
  beforeUnit() { admittedUnitCount += 1; }, beforeSynthesis() { synthesisAdmitted = true; } });
assert.equal(result.coverage.complete, true);
assert.deepEqual(result.coverage.sectionAliases, ["S1", "S2"]);
assert.deepEqual(result.coverage.sourceAliases, ["D1", "D2"]);
assert.equal(analyzedUnitIds.length, result.units.length);
assert.ok(result.units.length > 2, "An oversized node must be subdivided without truncation.");
assert.ok(result.units.every((unit) => unit.tokenCount <= route.capacity.availableDocumentTokens));
assert.ok(result.units.filter((unit) => unit.sourceAliases.includes("D1")).length > 1);
assert.equal(result.answer.content, "完整申请书综合分析");
assert.match(result.executionHash, /^[a-f0-9]{64}$/);
assert.equal(result.modelId, "test-model");
assert.equal(admittedUnitCount, result.units.length);
assert.equal(synthesisAdmitted, true);

let failingUnitCall = 0;
await assert.rejects(() => executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter,
  question: "验证分块失败审计", unitMaximumOutputTokens: 800, synthesisMaximumInputTokens: 10_000,
  synthesisMaximumOutputTokens: 2_400, maximumUnits: 20, model: { ...model,
    async analyzeUnit(input) {
      failingUnitCall += 1;
      if (failingUnitCall === 2) throw new GrantAssistantModelError("provider_transient_error", "unit failed", {
        providerRequestId: "unit-failed", usage: { inputTokens: 5, outputTokens: 1, reasoningTokens: 0 },
        failureStage: "answer_generation", requestDispatched: true, usageKnown: true,
        failureReason: createGrantAssistantProviderFailureReason({ category: "provider_transient_error",
          stage: "answer_generation", safeFacts: { requestDispatched: true, usageKnown: true } }) });
      return { summary: "first unit", provider: "openai", modelId: "test-model",
        providerRequestId: "unit-succeeded", usage: { inputTokens: 7, outputTokens: 2, reasoningTokens: 1 },
        findings: [{ statement: "first finding", sourceAliases: [input.allowedSourceAliases[0]!] }] };
    },
  } }), (error: unknown) => {
    assert.ok(error instanceof GrantAssistantModelError);
    assert.deepEqual(error.providerRequestIds, ["unit-succeeded", "unit-failed"]);
    assert.deepEqual(error.usage, { inputTokens: 12, outputTokens: 3, reasoningTokens: 1 });
    assert.equal(error.usageKnown, true);
    assert.equal(error.failureReason?.reasonCode, "provider.transient_error");
    return true;
  });

await assert.rejects(() => executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter,
  question: "评价整篇申请书", unitMaximumOutputTokens: 800, synthesisMaximumInputTokens: 10_000,
  synthesisMaximumOutputTokens: 2_400, maximumUnits: 20, model: { ...model,
    async analyzeUnit() { return { summary: "错误引用", provider: "openai", modelId: "test-model",
      findings: [{ statement: "错误", sourceAliases: ["D999"] }] }; } } }),
  /unavailable source alias/);

await assert.rejects(() => executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter, model,
  question: "评价整篇申请书", unitMaximumOutputTokens: 800, synthesisMaximumInputTokens: 1,
  synthesisMaximumOutputTokens: 2_400, maximumUnits: 20 }), (error: unknown) => {
    assert.ok(error instanceof GrantAssistantModelError);
    assert.match(error.message, /reduction stage is required/u);
    assert.equal(error.failureReason?.reasonCode, "budget.review_synthesis_required_context_exceeded");
    return true;
  });

await assert.rejects(() => executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter, model,
  question: "评价整篇申请书", unitMaximumOutputTokens: 800, synthesisMaximumInputTokens: 10_000,
  synthesisMaximumOutputTokens: 2_400, maximumUnits: 1 }), /maximum is 1/);

const gateway = new GrantModelDataGateway({ generate: async () => { throw new Error("not used"); } },
  undefined, undefined, undefined, tokenCounter);

const webContext = gateway.prepareWebGroundingContext({ documentId: context.documentId,
  sourceRevisionId: context.sourceRevisionId, snapshot, retrievedDocumentBlocks: [], fullDocument: true });
assert.equal(webContext.applicationContext, context.modelText, "web synthesis must receive the canonical full document");
assert.equal(webContext.coverage.complete, true);
assert.equal(webContext.coverage.coveredSectionCount, snapshot.sections.length);
assert.equal(webContext.coverage.coveredNodeCount, snapshot.nodes.length);
assert.ok(webContext.searchContext.length < webContext.applicationContext.length,
  "query rewriting should receive only the title and outline, not the full application");

console.log("Grant hierarchical full-document analysis covers every section and source without truncation.");
