import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeGrantFullDocumentHierarchicalAnalysis } from "../lib/grants/application/grant-full-document-hierarchical-analysis.ts";
import { routeGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-capacity-router.ts";
import { buildGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-context.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";
import { TiktokenGrantTokenCounter } from "../lib/grants/infrastructure/model/tiktoken-grant-token-counter.ts";
import type { GrantFullDocumentAnalysisModel } from "../lib/grants/ports/grant-full-document-analysis-model.ts";
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
    analyzedUnitIds.push(input.unitId);
    return { summary: `已分析 ${input.unitId}`, provider: "openai", modelId: "test-model",
      findings: input.allowedSourceAliases.length > 0
        ? [{ statement: "分块结论", sourceAliases: [input.allowedSourceAliases[0]!] }] : [] };
  },
  async synthesize(input) {
    return { content: "完整申请书综合分析", provider: "openai", modelId: "test-model", claims: [{ statement: "全文结论",
      sourceAliases: [...new Set(input.analyses.flatMap((analysis) =>
        analysis.findings.flatMap((finding) => finding.sourceAliases)))] }] };
  },
};
const result = await executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter, model,
  question: "评价整篇申请书", synthesisMaximumInputTokens: 10_000 });
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

await assert.rejects(() => executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter,
  question: "评价整篇申请书", synthesisMaximumInputTokens: 10_000, model: { ...model,
    async analyzeUnit() { return { summary: "错误引用", provider: "openai", modelId: "test-model",
      findings: [{ statement: "错误", sourceAliases: ["D999"] }] }; } } }),
  /unavailable source alias/);

await assert.rejects(() => executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter, model,
  question: "评价整篇申请书", synthesisMaximumInputTokens: 1 }), /reduction stage is required/);

let singlePassCalls = 0;
const gateway = new GrantModelDataGateway({
  generate: async () => { throw new Error("not used"); },
  ...model,
  async answerChat(request) {
    singlePassCalls += 1;
    assert.ok(request.admittedContext.some((item) => item.sourceAlias === "DOCSTRUCTURE"));
    assert.deepEqual(request.admittedContext.filter((item) => /^D\d+$/u.test(item.sourceAlias))
      .map((item) => item.sourceAlias), ["D1", "D2"]);
    return { content: "单次完整分析", claims: [{ claimId: "C1", statement: "全文结论", citationIds: ["X1"] }],
      citations: [{ citationId: "X1", sourceAlias: "D1" }], provider: "openai" as const,
      modelId: "test-model", usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 2 } };
  },
}, undefined, undefined, undefined, tokenCounter);
const gatewayResult = await gateway.answerFullDocumentAssistantChat({ documentId: context.documentId,
  sourceRevisionId: context.sourceRevisionId, snapshot, messages: [{ role: "user", content: "整体评价整篇申请书" }],
  attemptPurpose: "initial", capacityPolicy: { policyVersion: "gateway-full-v1", contextWindowTokens: 20_000,
    maximumInputTokens: 16_000, reservedOutputTokens: 2_000, protocolOverheadTokens: 100, safetyMarginTokens: 500 } });
assert.equal(singlePassCalls, 1);
assert.equal(gatewayResult.fullDocument.mode, "single_pass");
assert.equal(gatewayResult.fullDocument.coverage.complete, true);

const hierarchicalGatewayResult = await gateway.answerFullDocumentAssistantChat({ documentId: context.documentId,
  sourceRevisionId: context.sourceRevisionId, snapshot, messages: [{ role: "user", content: "评价整篇申请书" }],
  attemptPurpose: "initial", capacityPolicy: { policyVersion: "gateway-hierarchical-v1", contextWindowTokens: 4_000,
    maximumInputTokens: 3_000, reservedOutputTokens: 500, protocolOverheadTokens: 100, safetyMarginTokens: 200 } });
assert.equal(hierarchicalGatewayResult.fullDocument.mode, "hierarchical");
assert.equal(hierarchicalGatewayResult.fullDocument.coverage.complete, true);
assert.ok(hierarchicalGatewayResult.fullDocument.unitCount > 1);
assert.equal(hierarchicalGatewayResult.modelId, "test-model");

const webContext = gateway.prepareWebGroundingContext({ documentId: context.documentId,
  sourceRevisionId: context.sourceRevisionId, snapshot, retrievedDocumentBlocks: [], fullDocument: true });
assert.equal(webContext.applicationContext, context.modelText, "web synthesis must receive the canonical full document");
assert.equal(webContext.coverage.complete, true);
assert.equal(webContext.coverage.coveredSectionCount, snapshot.sections.length);
assert.equal(webContext.coverage.coveredNodeCount, snapshot.nodes.length);
assert.ok(webContext.searchContext.length < webContext.applicationContext.length,
  "query rewriting should receive only the title and outline, not the full application");

console.log("Grant hierarchical full-document analysis covers every section and source without truncation.");
