import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeGrantFullDocumentHierarchicalAnalysis } from "../lib/grants/application/grant-full-document-hierarchical-analysis.ts";
import { routeGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-capacity-router.ts";
import { buildGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-context.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";
import { TiktokenGrantTokenCounter } from "../lib/grants/infrastructure/model/tiktoken-grant-token-counter.ts";
import type { GrantFullDocumentAnalysisModel } from "../lib/grants/ports/grant-full-document-analysis-model.ts";

const firstSectionId = randomUUID();
const secondSectionId = randomUUID();
const longNodeId = randomUUID();
const shortNodeId = randomUUID();
const context = buildGrantFullDocumentContext({ documentId: randomUUID(), sourceRevisionId: randomUUID(),
  snapshot: CanonicalGrantSnapshotSchema.parse({ schemaVersion: "grant-canonical-v1", title: "全文分析测试",
    sections: [
      { sectionId: firstSectionId, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [longNodeId] },
      { sectionId: secondSectionId, semanticRole: "plan", title: "研究方案", order: 1, nodeIds: [shortNodeId] },
    ], nodes: [
      { nodeId: longNodeId, sectionId: firstSectionId, order: 0, nodeType: "paragraph", content: { text: "长段落科学问题与研究依据。".repeat(400) } },
      { nodeId: shortNodeId, sectionId: secondSectionId, order: 0, nodeType: "paragraph", content: { text: "研究方案正文。".repeat(20) } },
    ] }) });
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
    return { summary: `已分析 ${input.unitId}`, findings: input.allowedSourceAliases.length > 0
      ? [{ statement: "分块结论", sourceAliases: [input.allowedSourceAliases[0]!] }] : [] };
  },
  async synthesize(input) {
    return { content: "完整申请书综合分析", claims: [{ statement: "全文结论",
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

await assert.rejects(() => executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter,
  question: "评价整篇申请书", synthesisMaximumInputTokens: 10_000, model: { ...model,
    async analyzeUnit() { return { summary: "错误引用", findings: [{ statement: "错误", sourceAliases: ["D999"] }] }; } } }),
  /unavailable source alias/);

await assert.rejects(() => executeGrantFullDocumentHierarchicalAnalysis({ context, route, tokenCounter, model,
  question: "评价整篇申请书", synthesisMaximumInputTokens: 1 }), /reduction stage is required/);

console.log("Grant hierarchical full-document analysis covers every section and source without truncation.");
