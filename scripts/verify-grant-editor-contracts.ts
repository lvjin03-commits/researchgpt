import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { estimateGrantLength } from "../lib/grants/application/length-estimator.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { GrantDocumentSchema } from "../lib/grants/domain/contracts.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";

function sequentialIds() {
  let value = 0;
  return () => `20000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

const ownerId = "30000000-0000-4000-8000-000000000001";
assert.doesNotThrow(() => GrantDocumentSchema.parse({
  documentId: "30000000-0000-4000-8000-000000000010",
  ownerId,
  title: "PostgreSQL timestamp compatibility",
  templateSnapshotId: "30000000-0000-4000-8000-000000000011",
  currentRevisionId: "30000000-0000-4000-8000-000000000012",
  currentRevisionNumber: 1,
  createdAt: "2026-08-07T12:00:00+00:00",
  updatedAt: "2026-08-07T12:00:00.123456+00:00",
}));
const repository = new InMemoryGrantRevisionRepository();
const service = new GrantRevisionService({ repository, createId: sequentialIds(), now: () => "2026-08-07T12:00:00.000Z" });
const created = await service.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "Grant editor verification",
    sections: [{
      localKey: "basis",
      semanticRole: "project_basis",
      title: "立项依据",
      order: 0,
      nodes: [{ localKey: "body", nodeType: "paragraph", content: { text: "初始内容" } }],
    }],
  },
  template: { templateKey: "nsfc", templateVersion: "1", rules: { charactersPerPage: 10, maximumEstimatedPages: 2 } },
});

assert.equal((await service.listDocuments()).length, 1);
assert.equal((await service.getDocument(created.document.documentId)).currentRevision.revisionId, created.currentRevision.revisionId);

const archivedRepository = new InMemoryGrantRevisionRepository();
const archivedService = new GrantRevisionService({ repository: archivedRepository, createId: sequentialIds(), now: () => "2026-08-07T12:00:00.000Z" });
const archived = await archivedService.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "Archive verification",
    sections: [{
      localKey: "basis",
      semanticRole: "project_basis",
      title: "立项依据",
      order: 0,
      nodes: [{ localKey: "body", nodeType: "paragraph", content: { text: "待归档内容" } }],
    }],
  },
  template: { templateKey: "nsfc", templateVersion: "1", rules: {} },
});
await assert.rejects(() => archivedService.archiveDocument({
  documentId: archived.document.documentId,
  expectedRevisionId: "30000000-0000-4000-8000-000000000099",
  actorId: ownerId,
}), /changed after this operation began/);
await archivedService.archiveDocument({
  documentId: archived.document.documentId,
  expectedRevisionId: archived.currentRevision.revisionId,
  actorId: ownerId,
});
assert.equal((await archivedService.listDocuments()).length, 0);
await assert.rejects(() => archivedService.getDocument(archived.document.documentId), /was not found/);
await assert.rejects(() => archivedService.commitRevision({
  documentId: archived.document.documentId,
  expectedRevisionId: archived.currentRevision.revisionId,
  actorId: ownerId,
  actorKind: "user",
  snapshot: archived.currentRevision.snapshot,
  reason: "stale_editor_user_save",
}), /was not found/);

const editedSnapshot = structuredClone(created.currentRevision.snapshot);
editedSnapshot.nodes[0]!.content = { text: "这是一次经过用户确认保存的结构化正文内容" };
const edited = await service.commitRevision({
  documentId: created.document.documentId,
  expectedRevisionId: created.currentRevision.revisionId,
  actorId: ownerId,
  actorKind: "user",
  snapshot: editedSnapshot,
  reason: "editor_user_save",
});
assert.equal(edited.document.currentRevisionNumber, 2);

const restored = await service.restoreRevision({
  documentId: created.document.documentId,
  expectedRevisionId: edited.currentRevision.revisionId,
  sourceRevisionId: created.currentRevision.revisionId,
  actorId: ownerId,
});
assert.equal(restored.document.currentRevisionNumber, 3);
assert.equal(restored.currentRevision.parentRevisionId, edited.currentRevision.revisionId);
assert.deepEqual(restored.currentRevision.snapshot, created.currentRevision.snapshot);
assert.deepEqual((await service.listRevisionHistory(created.document.documentId)).map((revision) => revision.revisionNumber), [3, 2, 1]);

const estimate = estimateGrantLength(editedSnapshot, { charactersPerPage: 10, maximumEstimatedPages: 2 });
assert(estimate.visibleCharacters > 20);
assert(estimate.estimatedPages >= 3);
assert.equal(estimate.exceedsEstimatedLimit, true);

const migration = await readFile(new URL("../supabase/migrations/035_grant_editor_revision_reads.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.list_grant_documents/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_grant_document_revision/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.list_grant_document_revisions/);
assert.doesNotMatch(migration, /GRANT EXECUTE .* authenticated/);

const archiveMigration = await readFile(new URL("../supabase/migrations/044_grant_document_archival.sql", import.meta.url), "utf8");
assert.match(archiveMigration, /CREATE OR REPLACE FUNCTION public\.archive_grant_document/);
assert.match(archiveMigration, /current_document\.current_revision_id IS DISTINCT FROM p_expected_revision_id/);
assert.match(archiveMigration, /document\.deleted_at IS NULL/);
assert.match(archiveMigration, /CREATE TRIGGER grant_document_revisions_reject_archived/);
assert.doesNotMatch(archiveMigration, /GRANT EXECUTE .* authenticated/);

const editorServiceSource = await readFile(new URL("../lib/grants/application/editor-service.ts", import.meta.url), "utf8");
assert.match(editorServiceSource, /reason: "editor_user_save"/);
assert.doesNotMatch(editorServiceSource, /editor_autosave/);

console.log("Grant editor contracts passed.");
