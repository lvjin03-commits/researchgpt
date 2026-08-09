import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";
import { GrantPatchService } from "../lib/grants/application/patch-service.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { InMemoryGrantPatchRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-patch-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import type { GrantDiagnosticRepository } from "../lib/grants/ports/grant-diagnostic-repository.ts";
import type { GrantPatchModel } from "../lib/grants/ports/grant-patch-model.ts";
import { applyGrantPatch, GrantPatchPolicyError } from "../lib/grants/patching/patch-policy.ts";

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

const second = await service.propose({
  documentId: aggregate.document.documentId,
  baseRevisionId: accepted.aggregate.currentRevision.revisionId,
  targetNodeId,
  instruction: "再精简一些。",
  actorId: ownerId,
});
await service.reject(aggregate.document.documentId, second.proposalId);
assert.equal((await revisionService.getDocument(aggregate.document.documentId)).document.currentRevisionNumber, 2, "reject must not write canonical content");

console.log("Grant AI patch contracts passed.");
