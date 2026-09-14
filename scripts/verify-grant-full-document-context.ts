import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildGrantFullDocumentContext } from "../lib/grants/application/grant-full-document-context.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";

const rootId = randomUUID();
const childId = randomUUID();
const laterRootId = randomUUID();
const referencesId = randomUUID();
const emptySectionId = randomUUID();
const headingId = randomUUID();
const paragraphId = randomUUID();
const listId = randomUUID();
const tableId = randomUUID();
const figureId = randomUUID();
const formulaId = randomUUID();
const citationId = randomUUID();
const snapshot = CanonicalGrantSnapshotSchema.parse({
  schemaVersion: "grant-canonical-v1",
  title: "完整申请书",
  sections: [
    { sectionId: laterRootId, semanticRole: "research_basis", title: "研究基础", order: 1, nodeIds: [tableId, figureId] },
    { sectionId: childId, semanticRole: "significance", title: "研究意义", parentSectionId: rootId, order: 0, nodeIds: [listId] },
    { sectionId: rootId, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [paragraphId, headingId] },
    { sectionId: referencesId, semanticRole: "references", title: "参考文献", order: 2, nodeIds: [citationId, formulaId] },
    { sectionId: emptySectionId, semanticRole: "appendix", title: "附录", order: 3, nodeIds: [] },
  ],
  nodes: [
    { nodeId: figureId, sectionId: laterRootId, order: 1, nodeType: "figure", content: { assetId: randomUUID(), altText: "机理图", caption: "图1 界面机理" } },
    { nodeId: listId, sectionId: childId, order: 0, nodeType: "list", content: { ordered: true, items: ["目标一", "目标二"] } },
    { nodeId: paragraphId, sectionId: rootId, order: 0, nodeType: "paragraph", content: { text: "研究背景正文" } },
    { nodeId: headingId, sectionId: rootId, order: 1, nodeType: "heading", content: { text: "核心问题", level: 2 } },
    { nodeId: tableId, sectionId: laterRootId, order: 0, nodeType: "table", content: { rows: [["指标", "数值"], ["循环", "4000"]] } },
    { nodeId: formulaId, sectionId: referencesId, order: 1, nodeType: "formula", content: { latex: "E=mc^2" } },
    { nodeId: citationId, sectionId: referencesId, order: 0, nodeType: "citation", content: { referenceId: randomUUID() } },
  ],
});

const documentId = randomUUID();
const sourceRevisionId = randomUUID();
const context = buildGrantFullDocumentContext({ documentId, sourceRevisionId, snapshot });

assert.deepEqual(context.sections.map((section) => section.title), ["立项依据", "研究意义", "研究基础", "参考文献", "附录"]);
assert.deepEqual(context.sections.map((section) => section.depth), [0, 1, 0, 0, 0]);
assert.equal(context.sections[1]!.parentSectionAlias, context.sections[0]!.sectionAlias);
assert.deepEqual(context.nodes.map((node) => node.nodeId),
  [paragraphId, headingId, listId, tableId, figureId, citationId, formulaId]);
assert.deepEqual(context.nodes.map((node) => node.sourceAlias), ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]);
assert.deepEqual(context.coverage, { sectionCount: 5, nodeCount: 7, emptySectionCount: 1,
  coveredSectionCount: 5, coveredNodeCount: 7, complete: true });
for (const expected of ["完整申请书", "研究背景正文", "核心问题", "1. 目标一", "循环 | 4000", "图1 界面机理", "E=mc^2", "附录"]) {
  assert.ok(context.modelText.includes(expected), `Missing full-document text: ${expected}`);
}
assert.ok(!context.modelText.includes(context.nodes[0]!.nodeId), "Model text must not expose canonical node UUIDs.");
assert.ok(!context.modelText.includes(context.sections[0]!.sectionId), "Model text must not expose canonical section UUIDs.");
assert.equal(context.contextHash,
  buildGrantFullDocumentContext({ documentId, sourceRevisionId, snapshot }).contextHash,
  "The same Revision projection must be fingerprint-stable.");
assert.notEqual(context.contextHash,
  buildGrantFullDocumentContext({ documentId, sourceRevisionId: randomUUID(), snapshot }).contextHash,
  "A different Revision must not reuse the full-document fingerprint.");

console.log("Grant full-document context covers every canonical section and node in order.");
