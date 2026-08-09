import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GrantEvidenceService } from "../lib/grants/application/evidence-service.ts";
import { GrantEvidenceProviderPolicyError, GrantModelDataGateway, GrantPatchEvidenceMismatchError } from "../lib/grants/application/grant-model-data-gateway.ts";
import { GrantPatchService } from "../lib/grants/application/patch-service.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { InMemoryGrantEvidenceRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-evidence-repository.ts";
import { InMemoryGrantPatchRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-patch-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import type { GrantDiagnosticRepository } from "../lib/grants/ports/grant-diagnostic-repository.ts";
import type { GrantEvidenceParser } from "../lib/grants/ports/grant-evidence-parser.ts";
import type { GrantEvidenceStorage } from "../lib/grants/ports/grant-evidence-storage.ts";
import type { GrantPatchModel } from "../lib/grants/ports/grant-patch-model.ts";

const ownerId = randomUUID();
const revisions = new GrantRevisionService({ repository: new InMemoryGrantRevisionRepository() });
const aggregate = await revisions.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "国自然申请书",
    sections: [{
      localKey: "basis",
      semanticRole: "rationale",
      title: "立项依据",
      order: 0,
      nodes: [{ localKey: "p1", nodeType: "paragraph", content: { text: "该机制仍缺少直接证据。" } }],
    }],
  },
  template: { templateKey: "nsfc-general", templateVersion: "1", rules: {} },
});
const evidenceRepository = new InMemoryGrantEvidenceRepository();
const parser: GrantEvidenceParser = {
  async parse() {
    const text = "前期实验显示，该信号轴上调后细胞迁移能力显著增强，并在独立重复实验中得到验证。";
    return { text, originalLength: text.length, truncated: false };
  },
};
const storage: GrantEvidenceStorage = {
  async store(input) { return { bucket: "test", path: `${input.ownerId}/${input.documentId}/${input.sourceId}` }; },
  async remove() {},
};
const evidence = new GrantEvidenceService(revisions, evidenceRepository, storage, parser);
const resource = await evidence.upload({
  ownerId,
  actorId: ownerId,
  documentId: aggregate.document.documentId,
  fileName: "preliminary-results.docx",
  mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("test"),
  provenanceType: "own_unpublished_work",
  sensitivity: "unpublished_research",
});
await evidence.authorization.update({
  documentId: aggregate.document.documentId,
  sourceId: resource.source.sourceId,
  expectedRevision: resource.authorization.revision,
  permissions: {
    read: true,
    index: true,
    sendRelevantExcerptToModel: true,
    useForReasoning: true,
    useForCitation: false,
  },
  actorId: ownerId,
});

const modelRequests: Parameters<GrantPatchModel["generate"]>[0][] = [];
const model: GrantPatchModel = {
  async generate(request) {
    modelRequests.push(request);
    return {
      replacementText: "前期实验提示该信号轴可能促进细胞迁移，但仍需进一步验证其因果机制。",
      rationale: "依据已授权的前期实验资料补充证据边界。",
      provider: "openai",
      modelId: "test-model",
      usedEvidenceCardIds: [request.evidence[0]!.cardId],
    };
  },
};
const diagnostics: GrantDiagnosticRepository = {
  async saveExecution(input) { return input; },
  async listFindings() { return []; },
  async listConflicts() { return []; },
};
const patchRepository = new InMemoryGrantPatchRepository();
const patches = new GrantPatchService(
  revisions,
  diagnostics,
  patchRepository,
  new GrantModelDataGateway(model, evidence.authorization),
);
const proposal = await patches.propose({
  documentId: aggregate.document.documentId,
  baseRevisionId: aggregate.currentRevision.revisionId,
  targetNodeId: aggregate.currentRevision.snapshot.nodes[0].nodeId,
  instruction: "结合前期实验资料强化论证，但保留不确定性边界。",
  actorId: ownerId,
  evidenceSourceIds: [resource.source.sourceId],
});
assert.equal(modelRequests[0].evidence.length, 1);
assert.equal(proposal.evidenceBindings.length, 1);
assert.equal("excerpt" in proposal.evidenceBindings[0], false, "proposal must not duplicate sensitive excerpts");
assert.equal(patchRepository.evidenceDependencies.size, 1, "proposal must create a revocation dependency");

const highlySensitive = await evidence.upload({
  ownerId,
  actorId: ownerId,
  documentId: aggregate.document.documentId,
  fileName: "restricted-material.txt",
  mediaType: "text/plain",
  buffer: Buffer.from("restricted"),
  provenanceType: "project_material",
  sensitivity: "highly_sensitive",
});
await evidence.authorization.update({
  documentId: aggregate.document.documentId,
  sourceId: highlySensitive.source.sourceId,
  expectedRevision: highlySensitive.authorization.revision,
  permissions: { read: true, index: true, sendRelevantExcerptToModel: true, useForReasoning: true, useForCitation: false },
  actorId: ownerId,
});
await assert.rejects(patches.propose({
  documentId: aggregate.document.documentId,
  baseRevisionId: aggregate.currentRevision.revisionId,
  targetNodeId: aggregate.currentRevision.snapshot.nodes[0].nodeId,
  instruction: "尝试使用高度敏感资料",
  actorId: ownerId,
  evidenceSourceIds: [highlySensitive.source.sourceId],
}), GrantEvidenceProviderPolicyError);

const maliciousModel: GrantPatchModel = {
  async generate(request) {
    return {
      replacementText: "越权修改",
      provider: "openai",
      modelId: "test-model",
      usedEvidenceCardIds: [randomUUID(), request.evidence[0]!.cardId],
    };
  },
};
const maliciousPatches = new GrantPatchService(
  revisions,
  diagnostics,
  new InMemoryGrantPatchRepository(),
  new GrantModelDataGateway(maliciousModel, evidence.authorization),
);
await assert.rejects(maliciousPatches.propose({
  documentId: aggregate.document.documentId,
  baseRevisionId: aggregate.currentRevision.revisionId,
  targetNodeId: aggregate.currentRevision.snapshot.nodes[0].nodeId,
  instruction: "测试越权证据卡",
  actorId: ownerId,
  evidenceSourceIds: [resource.source.sourceId],
}), GrantPatchEvidenceMismatchError);

const current = await evidenceRepository.getResource(aggregate.document.documentId, resource.source.sourceId);
await evidence.authorization.revoke({
  documentId: aggregate.document.documentId,
  sourceId: resource.source.sourceId,
  expectedRevision: current!.authorization.revision,
  actorId: ownerId,
});
await assert.rejects(
  patches.accept(aggregate.document.documentId, proposal.proposalId, ownerId),
  /Current evidence authorization does not permit this use/,
  "revoked evidence must block proposal acceptance",
);

const migration = await readFile(new URL("../supabase/migrations/041_grant_evidence_backed_patches.sql", import.meta.url), "utf8");
const revisionRepository = await readFile(
  new URL("../lib/grants/infrastructure/supabase/supabase-grant-revision-repository.ts", import.meta.url),
  "utf8",
);
assert.match(migration, /create_grant_evidence_backed_patch_proposal/);
assert.match(migration, /PERFORM public\.create_grant_patch_proposal/);
assert.match(migration, /INSERT INTO public\.grant_evidence_dependencies/);
assert.match(migration, /commit_grant_evidence_patch_revision/);
assert.match(migration, /FOR UPDATE OF proposal/);
assert.match(migration, /v_committed := public\.commit_grant_document_revision/);
assert.match(migration, /status = 'accepted'/);
assert.doesNotMatch(migration, /GRANT EXECUTE.*authenticated/);
assert.match(revisionRepository, /input\.evidencePatchProposalId/);
assert.match(revisionRepository, /commit_grant_evidence_patch_revision/);

console.log("Grant evidence-backed Patch contracts passed.");
