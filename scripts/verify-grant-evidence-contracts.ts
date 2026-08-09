import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GrantEvidenceAuthorizationConflictError, GrantEvidenceUseDeniedError } from "../lib/grants/application/evidence-authorization-service.ts";
import { GrantEvidenceService } from "../lib/grants/application/evidence-service.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import type { GrantEvidenceParser } from "../lib/grants/ports/grant-evidence-parser.ts";
import type { GrantEvidenceStorage } from "../lib/grants/ports/grant-evidence-storage.ts";
import { InMemoryGrantEvidenceRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-evidence-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import { createGrantEvidenceObjectPath } from "../lib/grants/infrastructure/supabase/grant-evidence-object-path.ts";

function sequentialIds(start = 1) {
  let value = start;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

const ownerId = "10000000-0000-4000-8000-000000000001";
const revisionService = new GrantRevisionService({ repository: new InMemoryGrantRevisionRepository(), createId: sequentialIds(100) });
const aggregate = await revisionService.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "证据授权测试",
    sections: [{ localKey: "basis", semanticRole: "basis", title: "立项依据", order: 0, nodes: [] }],
  },
  template: { templateKey: "nsfc", templateVersion: "1", rules: {} },
});

const stored = new Set<string>();
const removed: string[] = [];
const storage: GrantEvidenceStorage = {
  async store(input) {
    const path = createGrantEvidenceObjectPath(input.ownerId, input.documentId, input.sourceId);
    stored.add(path);
    return { bucket: "test", path };
  },
  async remove(input) {
    assert(stored.has(input.path), "deletion must target the stored program-owned object path");
    stored.delete(input.path);
    removed.push(input.path);
  },
};
const parser: GrantEvidenceParser = {
  async parse() {
    const text = "第一段说明已发表研究的实验设计。\n\n第二段说明该研究的适用边界。";
    return { text, originalLength: text.length, truncated: false };
  },
};
const repository = new InMemoryGrantEvidenceRepository();
let second = 0;
const service = new GrantEvidenceService(
  revisionService,
  repository,
  storage,
  parser,
  undefined,
  sequentialIds(1000),
  () => `2026-08-08T00:00:${String(second++).padStart(2, "0")}.000Z`,
);

const first = await service.upload({
  ownerId,
  actorId: ownerId,
  documentId: aggregate.document.documentId,
  fileName: "published-study.pdf",
  mediaType: "application/pdf",
  buffer: Buffer.from("synthetic-pdf"),
  provenanceType: "published_literature",
  sensitivity: "project_confidential",
});
assert.equal(first.cards.length, 1);
assert.equal(first.authorization.permissions.read, true);
assert.equal(first.authorization.permissions.sendRelevantExcerptToModel, false, "upload must deny model use by default");
await assert.rejects(
  service.authorization.materializeCurrent({ documentId: aggregate.document.documentId, sourceIds: [first.source.sourceId], use: "model" }),
  GrantEvidenceUseDeniedError,
);

const authorized = await service.authorization.update({
  documentId: aggregate.document.documentId,
  sourceId: first.source.sourceId,
  expectedRevision: first.authorization.revision,
  actorId: ownerId,
  permissions: {
    read: true,
    index: true,
    sendRelevantExcerptToModel: true,
    useForReasoning: true,
    useForCitation: true,
  },
});
assert.equal(authorized.revision, 2);
assert.equal((await service.authorization.materializeCurrent({
  documentId: aggregate.document.documentId,
  sourceIds: [first.source.sourceId],
  use: "reasoning",
}))[0]?.cards[0]?.excerpt.includes("实验设计"), true);
await assert.rejects(
  service.authorization.update({
    documentId: aggregate.document.documentId,
    sourceId: first.source.sourceId,
    expectedRevision: 1,
    actorId: ownerId,
    permissions: authorized.permissions,
  }),
  GrantEvidenceAuthorizationConflictError,
);

const dependencyIds = sequentialIds(2000);
for (const dependentKind of ["queued_model_call", "context_cache", "patch_proposal"] as const) {
  await repository.registerDependency({
    dependencyId: dependencyIds(),
    documentId: aggregate.document.documentId,
    sourceId: first.source.sourceId,
    dependentKind,
    dependentId: dependencyIds(),
    status: "active",
    createdAt: "2026-08-08T00:01:00.000Z",
    updatedAt: "2026-08-08T00:01:00.000Z",
  });
}
const revoked = await service.authorization.revoke({
  documentId: aggregate.document.documentId,
  sourceId: first.source.sourceId,
  expectedRevision: 2,
  actorId: ownerId,
});
assert.equal(revoked.source.status, "revoked");
assert.equal(revoked.authorization.permissions.read, false);
assert((await repository.listDependencies(aggregate.document.documentId, first.source.sourceId)).every((item) => item.status === "evidence_revoked"));
await assert.rejects(
  service.authorization.materializeCurrent({ documentId: aggregate.document.documentId, sourceIds: [first.source.sourceId], use: "citation" }),
  GrantEvidenceUseDeniedError,
);

const secondResource = await service.upload({
  ownerId,
  actorId: ownerId,
  documentId: aggregate.document.documentId,
  fileName: "own-results.docx",
  mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from("synthetic-docx"),
  provenanceType: "own_unpublished_work",
  sensitivity: "unpublished_research",
});
const deleted = await service.delete({ documentId: aggregate.document.documentId, sourceId: secondResource.source.sourceId, actorId: ownerId });
assert.equal(deleted.source.status, "deleted");
assert.equal(deleted.source.storage, undefined);
assert.deepEqual(deleted.cards, []);
assert.equal(removed.length, 1);
assert.equal((await service.list(aggregate.document.documentId)).some((item) => item.source.sourceId === secondResource.source.sourceId), false, "deleted evidence must disappear from the active project-resource list");

const migration = await readFile(new URL("../supabase/migrations/040_grant_evidence_authorization.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.grant_evidence_authorizations/);
assert.match(migration, /UPDATE public\.grant_evidence_dependencies SET status = 'evidence_revoked'/);
assert.match(migration, /UPDATE public\.grant_patch_proposals AS proposal SET status = 'evidence_revoked'/);
assert.match(migration, /DELETE FROM public\.grant_evidence_cards WHERE source_id = p_source_id/);
assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE).* TO authenticated/);

const panel = await readFile(new URL("../components/grants/grant-evidence-panel.tsx", import.meta.url), "utf8");
assert.match(panel, /默认不会发送给 AI/);
assert.match(panel, /撤权后，排队任务、缓存和未接受提案都不能继续使用/);
assert.match(panel, /读取、推理与引用权限相互独立/);

console.log("Grant evidence authorization contracts passed.");
