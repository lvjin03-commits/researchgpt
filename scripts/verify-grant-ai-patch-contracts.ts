import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";
import { GrantPatchService } from "../lib/grants/application/patch-service.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { InMemoryGrantPatchRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-patch-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import type { GrantDiagnosticRepository } from "../lib/grants/ports/grant-diagnostic-repository.ts";
import type { GrantPatchModel } from "../lib/grants/ports/grant-patch-model.ts";
import { applyGrantPatch, GrantPatchPolicyError, validateGrantPatchFactSafety } from "../lib/grants/patching/patch-policy.ts";

const ownerId = randomUUID();
const revisionRepository = new InMemoryGrantRevisionRepository();
const revisionService = new GrantRevisionService({ repository: revisionRepository });
const aggregate = await revisionService.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "测试申请书",
    sections: [{
      localKey: "basis",
      semanticRole: "rationale",
      title: "立项依据",
      order: 0,
      nodes: [{ localKey: "basis-p1", nodeType: "paragraph", content: { text: "原始研究背景。" } }],
    }],
  },
  template: { templateKey: "nsfc-general", templateVersion: "1", rules: {} },
});
const targetNodeId = aggregate.currentRevision.snapshot.nodes[0].nodeId;

const emptyDiagnostics: GrantDiagnosticRepository = {
  async saveExecution(input) { return input; },
  async listFindings() { return []; },
  async listConflicts() { return []; },
};
const modelRequests: Parameters<GrantPatchModel["generate"]>[0][] = [];
const model: GrantPatchModel = {
  async generate(request) {
    modelRequests.push(request);
    return {
      replacementText: request.targetText === "原始研究背景。" ? "修改后的研究背景。" : "精简后的研究背景。",
      rationale: "按用户要求增强表达。",
      provider: "openai",
      modelId: "test-model",
      usedEvidenceCardIds: [],
    };
  },
};
const patchRepository = new InMemoryGrantPatchRepository();
const service = new GrantPatchService(
  revisionService,
  emptyDiagnostics,
  patchRepository,
  new GrantModelDataGateway(model),
);

const proposal = await service.propose({
  documentId: aggregate.document.documentId,
  baseRevisionId: aggregate.currentRevision.revisionId,
  targetNodeId,
  instruction: "加强逻辑，但不要增加新结论。",
  actorId: ownerId,
});
assert.equal(proposal.status, "pending");
assert.equal((await revisionService.getDocument(aggregate.document.documentId)).document.currentRevisionNumber, 1, "proposal must not write canonical content");
assert.equal(modelRequests[0].targetText, "原始研究背景。");
assert.deepEqual(modelRequests[0].evidence, [], "evidence-free PR5 behavior must remain available");

const unauthorized = structuredClone(proposal);
unauthorized.targetNodeIds = [randomUUID()];
assert.throws(
  () => applyGrantPatch(aggregate.currentRevision.snapshot, unauthorized),
  (error) => error instanceof GrantPatchPolicyError && error.code === "grant_patch_scope_invalid",
);

const accepted = await service.accept(aggregate.document.documentId, proposal.proposalId, ownerId);
assert.equal(accepted.proposal.status, "accepted");
assert.equal(accepted.aggregate.document.currentRevisionNumber, 2);
const acceptedNode = accepted.aggregate.currentRevision.snapshot.nodes[0];
assert.equal(acceptedNode.nodeType, "paragraph");
assert.equal(acceptedNode.nodeType === "paragraph" ? acceptedNode.content.text : "", "修改后的研究背景。");
const acceptedAgain = await service.accept(aggregate.document.documentId, proposal.proposalId, ownerId);
assert.equal(acceptedAgain.proposal.acceptedRevisionId, accepted.proposal.acceptedRevisionId, "repeat acceptance must be idempotent");
assert.equal(acceptedAgain.aggregate.document.currentRevisionNumber, 2);
const audit = (await revisionService.listAuditEvents(aggregate.document.documentId)).find(
  (event) => event.metadata.patchProposalId === proposal.proposalId,
);
assert.equal(audit?.metadata.contentOrigin, "ai_proposal");
assert.equal(audit?.actorKind, "user", "the accepting user remains the canonical writer actor");

assert.throws(
  () => validateGrantPatchFactSafety({ oldText: "已有设计。", newText: "实验结果表明效率提升30%。", hasAuthorizedEvidence: false }),
  (error) => error instanceof GrantPatchPolicyError && error.code === "grant_patch_new_numeric_claim_blocked",
);
assert.throws(
  () => validateGrantPatchFactSafety({ oldText: "已有设计。", newText: "前期实验已证实该机制。", hasAuthorizedEvidence: false }),
  (error) => error instanceof GrantPatchPolicyError && error.code === "grant_patch_new_factual_claim_blocked",
);
assert.throws(
  () => validateGrantPatchFactSafety({ oldText: "已有设计。", newText: "已有研究支持该结论[12]。", hasAuthorizedEvidence: true }),
  (error) => error instanceof GrantPatchPolicyError && error.code === "grant_patch_new_reference_blocked",
);
assert.doesNotThrow(() => validateGrantPatchFactSafety({
  oldText: "循环寿命达到4000 h。",
  newText: "循环寿命达到4000 h，说明性能较稳定。",
  hasAuthorizedEvidence: false,
}), "existing measurements may be preserved without being treated as new claims");
assert.doesNotThrow(() => validateGrantPatchFactSafety({
  oldText: "已有设计。",
  newText: "证据支持效率提升30%。",
  hasAuthorizedEvidence: true,
}), "authorized evidence may support a new numeric claim");

const second = await service.propose({
  documentId: aggregate.document.documentId,
  baseRevisionId: accepted.aggregate.currentRevision.revisionId,
  targetNodeId,
  instruction: "再精简一些。",
  actorId: ownerId,
});
await service.reject(aggregate.document.documentId, second.proposalId);
assert.equal((await revisionService.getDocument(aggregate.document.documentId)).document.currentRevisionNumber, 2, "reject must not write canonical content");

const selectionBase = accepted.aggregate.currentRevision.snapshot.nodes[0];
assert.equal(selectionBase?.nodeType, "paragraph");
const selectionBaseText = selectionBase?.nodeType === "paragraph" ? selectionBase.content.text : "";
const selectionText = selectionBaseText.slice(0, 2);
const selected = await service.propose({
  documentId: aggregate.document.documentId,
  baseRevisionId: accepted.aggregate.currentRevision.revisionId,
  targetNodeId,
  instruction: "只改写选中的文字。",
  editMode: "replace_selection",
  selection: { startOffset: 0, endOffset: 2, text: selectionText },
  actorId: ownerId,
});
assert.equal(selected.operations[0]?.type, "replace_selection");
assert.equal(modelRequests.at(-1)?.targetText, selectionText, "the model receives only the authorized selection");
const selectionPreview = applyGrantPatch(accepted.aggregate.currentRevision.snapshot, selected);
const selectedPreviewNode = selectionPreview.nodes.find((node) => node.nodeId === targetNodeId);
assert.equal(selectedPreviewNode?.nodeType, "paragraph");
if (selected.operations[0]?.type === "replace_selection" && selectedPreviewNode?.nodeType === "paragraph") {
  assert.equal(selectedPreviewNode.content.text, `${selected.operations[0].newText}${selectionBaseText.slice(2)}`);
}
await service.reject(aggregate.document.documentId, selected.proposalId);
await assert.rejects(
  service.propose({
    documentId: aggregate.document.documentId,
    baseRevisionId: accepted.aggregate.currentRevision.revisionId,
    targetNodeId,
    instruction: "错误选区不应执行。",
    editMode: "replace_selection",
    selection: { startOffset: 0, endOffset: 2, text: "不匹配" },
    actorId: ownerId,
  }),
  /selected text no longer matches/i,
);

const inserted = await service.propose({
  documentId: aggregate.document.documentId,
  baseRevisionId: accepted.aggregate.currentRevision.revisionId,
  targetNodeId,
  instruction: "在当前段落后补充一段过渡说明，不要增加新事实。",
  editMode: "insert_after",
  actorId: ownerId,
});
assert.equal(inserted.operations[0]?.type, "insert_after");
const insertedPreview = applyGrantPatch(accepted.aggregate.currentRevision.snapshot, inserted);
const insertOperation = inserted.operations[0];
assert.equal(insertedPreview.sections[0]?.nodeIds.length, 2);
if (insertOperation?.type === "insert_after") {
  assert.equal(insertedPreview.sections[0]?.nodeIds[1], insertOperation.newNodeId);
  const newNode = insertedPreview.nodes.find((node) => node.nodeId === insertOperation.newNodeId);
  assert.equal(newNode?.nodeType, "paragraph");
  assert.equal(newNode?.order, 1);
}
const acceptedInsert = await service.accept(aggregate.document.documentId, inserted.proposalId, ownerId);
assert.equal(acceptedInsert.aggregate.document.currentRevisionNumber, 3);
assert.equal(acceptedInsert.aggregate.currentRevision.snapshot.sections[0]?.nodeIds.length, 2);
assert.equal(modelRequests.at(-1)?.editMode, "insert_after");

console.log("Grant AI patch contracts passed.");
