import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { routeGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-capacity-router.ts";
import type { GrantFullDocumentContext } from "../lib/grants/application/grant-full-document-context.ts";
import { TiktokenGrantTokenCounter } from "../lib/grants/infrastructure/model/tiktoken-grant-token-counter.ts";

const counter = new TiktokenGrantTokenCounter();
assert.equal(counter.tokenizerId, "o200k_base");
assert.equal(counter.count("申请书全文"), 3);

const sections = ["立项依据", "研究内容", "研究基础"].map((title, index) => ({
  sectionAlias: `S${index + 1}`, sectionId: randomUUID(), parentSectionAlias: null,
  depth: 0, order: index, semanticRole: `role-${index}`, title, nodeAliases: [`D${index + 1}`],
  modelText: `# [S${index + 1}] ${title}\n\n[D${index + 1}] (paragraph)\n${"研究内容与科学问题。".repeat(40)}`,
}));
const context = { schemaVersion: "grant-full-document-context-v1", documentId: randomUUID(),
  sourceRevisionId: randomUUID(), title: "测试申请书", sections,
  nodes: sections.map((section, index) => ({ sourceAlias: `D${index + 1}`, nodeId: randomUUID(),
    sectionAlias: section.sectionAlias, nodeType: "paragraph" as const, order: 0, text: "研究内容与科学问题。".repeat(40) })),
  modelText: [`申请书标题：测试申请书`, ...sections.map((section) => section.modelText)].join("\n\n"),
  contextHash: "a".repeat(64), coverage: { sectionCount: 3, nodeCount: 3, emptySectionCount: 0,
    coveredSectionCount: 3, coveredNodeCount: 3, complete: true as const },
} satisfies GrantFullDocumentContext;
const basePolicy = { policyVersion: "test-capacity-v1", contextWindowTokens: 8_000,
  maximumInputTokens: 6_000, reservedOutputTokens: 1_000, protocolOverheadTokens: 20, safetyMarginTokens: 200 };

const direct = routeGrantFullDocumentContext({ context, tokenCounter: counter,
  fixedPromptText: "系统提示\n用户问题", policy: basePolicy });
assert.equal(direct.mode, "single_pass");
assert.equal(direct.capacity.fullDocumentTokens, counter.count(context.modelText));

const hierarchical = routeGrantFullDocumentContext({ context, tokenCounter: counter,
  fixedPromptText: "系统提示\n用户问题", policy: { ...basePolicy,
    contextWindowTokens: 600, maximumInputTokens: 500, reservedOutputTokens: 100, safetyMarginTokens: 20 } });
assert.equal(hierarchical.mode, "hierarchical");
assert.deepEqual(hierarchical.chunks.flatMap((chunk) => chunk.sectionAliases), ["S1", "S2", "S3"]);
assert.equal(hierarchical.completeSectionCoverage, true);
assert.ok(hierarchical.chunks.length > 1);

const unavailable = routeGrantFullDocumentContext({ context, tokenCounter: counter,
  fixedPromptText: "固定上下文".repeat(100), policy: { ...basePolicy,
    contextWindowTokens: 100, maximumInputTokens: 100, reservedOutputTokens: 20,
    protocolOverheadTokens: 10, safetyMarginTokens: 10 } });
assert.equal(unavailable.mode, "unavailable");
assert.equal(unavailable.reason, "fixed_context_exceeds_capacity");

const oversized = routeGrantFullDocumentContext({ context: { ...context,
  sections: [{ ...sections[0]!, modelText: "超长章节".repeat(1_000) }],
  nodes: [context.nodes[0]!], modelText: "超长章节".repeat(1_000), coverage: { sectionCount: 1, nodeCount: 1,
    emptySectionCount: 0, coveredSectionCount: 1, coveredNodeCount: 1, complete: true } },
  tokenCounter: counter, fixedPromptText: "固定", policy: { ...basePolicy,
    contextWindowTokens: 300, maximumInputTokens: 250, reservedOutputTokens: 50,
    protocolOverheadTokens: 10, safetyMarginTokens: 10 } });
assert.equal(oversized.mode, "hierarchical");
assert.deepEqual(oversized.oversizedSectionAliases, ["S1"]);

assert.throws(() => routeGrantFullDocumentContext({ context: { ...context,
  coverage: { ...context.coverage, coveredSectionCount: 2 } }, tokenCounter: counter,
  fixedPromptText: "固定", policy: basePolicy }), /complete full-document context/);

console.log("Grant full-document capacity routing uses exact tokenizer counts and never truncates coverage.");
