import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GrantRevisionConflictError, GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { CanonicalGrantSnapshotSchema } from "../lib/grants/domain/contracts.ts";
import { sha256Canonical } from "../lib/grants/domain/canonical-json.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import { SupabaseGrantRevisionRepository } from "../lib/grants/infrastructure/supabase/supabase-grant-revision-repository.ts";

function createSequentialId() {
  let value = 0;
  return () => {
    value += 1;
    return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
  };
}

const ownerId = "10000000-0000-4000-8000-000000000001";
const repository = new InMemoryGrantRevisionRepository();
const service = new GrantRevisionService({
  repository,
  createId: createSequentialId(),
  now: (() => {
    let second = 0;
    return () => `2026-08-07T00:00:${String(second++).padStart(2, "0")}.000Z`;
  })(),
});

const created = await service.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "跨尺度调控机制研究",
    sections: [
      {
        localKey: "basis",
        semanticRole: "project_basis",
        title: "立项依据",
        order: 0,
        nodes: [
          { localKey: "basis-heading", nodeType: "heading", content: { text: "1 立项依据", level: 1 } },
          { localKey: "basis-body", nodeType: "paragraph", content: { text: "现有研究尚未解释跨尺度因果传递。" } },
        ],
      },
      {
        localKey: "background",
        semanticRole: "research_background",
        title: "研究背景",
        parentLocalKey: "basis",
        order: 0,
        nodes: [
          { localKey: "background-body", nodeType: "paragraph", content: { text: "申请人已获得可重复的前期结果。" } },
        ],
      },
    ],
  },
  template: {
    templateKey: "nsfc-general-2027",
    templateVersion: "1",
    rules: { maximumEstimatedPages: 30, language: "zh" },
  },
});

assert.equal(created.document.currentRevisionNumber, 1);
assert.equal(created.currentRevision.snapshot.sections.length, 2);
assert.equal(created.currentRevision.snapshot.nodes.length, 3);
assert.equal(created.currentRevision.contentHash, sha256Canonical(created.currentRevision.snapshot));
assert.equal(created.currentRevision.snapshot.sections[1]?.parentSectionId, created.currentRevision.snapshot.sections[0]?.sectionId);
assert.equal(new Set(created.currentRevision.snapshot.nodes.map((node) => node.nodeId)).size, 3);

// Returned objects are not repository authority: local mutation cannot change stored state.
created.templateSnapshot.rules.maximumEstimatedPages = 999;
const reread = await repository.get(created.document.documentId);
assert.equal(reread?.templateSnapshot.rules.maximumEstimatedPages, 30);

const nextSnapshot = structuredClone(created.currentRevision.snapshot);
const bodyNode = nextSnapshot.nodes.find((node) => node.nodeType === "paragraph");
assert(bodyNode?.nodeType === "paragraph");
bodyNode.content.text = "现有研究尚未建立跨尺度因果传递的统一模型。";
const committed = await service.commitRevision({
  documentId: created.document.documentId,
  expectedRevisionId: created.currentRevision.revisionId,
  actorId: ownerId,
  actorKind: "user",
  snapshot: nextSnapshot,
  reason: "user_edit",
});
assert.equal(committed.document.currentRevisionNumber, 2);
assert.equal(committed.currentRevision.parentRevisionId, created.currentRevision.revisionId);
assert.equal((await repository.listAuditEvents(created.document.documentId)).length, 2);

await assert.rejects(
  service.commitRevision({
    documentId: created.document.documentId,
    expectedRevisionId: created.currentRevision.revisionId,
    actorId: ownerId,
    actorKind: "ai",
    snapshot: created.currentRevision.snapshot,
    reason: "stale_ai_patch",
  }),
  GrantRevisionConflictError,
);
assert.equal((await repository.get(created.document.documentId))?.document.currentRevisionNumber, 2);

const raceBase = committed.currentRevision;
const raceA = structuredClone(raceBase.snapshot);
const raceB = structuredClone(raceBase.snapshot);
raceA.title = "用户修改后的标题";
raceB.title = "AI修改后的标题";
const race = await Promise.allSettled([
  service.commitRevision({ documentId: created.document.documentId, expectedRevisionId: raceBase.revisionId, actorId: ownerId, actorKind: "user", snapshot: raceA, reason: "concurrent_user_edit" }),
  service.commitRevision({ documentId: created.document.documentId, expectedRevisionId: raceBase.revisionId, actorId: ownerId, actorKind: "ai", snapshot: raceB, reason: "concurrent_ai_patch" }),
]);
assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(race.filter((result) => result.status === "rejected" && result.reason instanceof GrantRevisionConflictError).length, 1);

const invalidSnapshot = structuredClone(committed.currentRevision.snapshot);
invalidSnapshot.sections[0]!.nodeIds.push(invalidSnapshot.sections[1]!.nodeIds[0]!);
assert.equal(CanonicalGrantSnapshotSchema.safeParse(invalidSnapshot).success, false);

assert.equal(
  sha256Canonical({ b: 2, a: { d: 4, c: 3 } }),
  sha256Canonical({ a: { c: 3, d: 4 }, b: 2 }),
);
assert.notEqual(sha256Canonical(["a", "b"]), sha256Canonical(["b", "a"]));

const cyclicDraft = {
  title: "非法循环",
  sections: [
    { localKey: "a", semanticRole: "a", title: "A", parentLocalKey: "b", order: 0, nodes: [] },
    { localKey: "b", semanticRole: "b", title: "B", parentLocalKey: "a", order: 0, nodes: [] },
  ],
};
const { GrantDocumentDraftSchema } = await import("../lib/grants/domain/contracts.ts");
assert.equal(GrantDocumentDraftSchema.safeParse(cyclicDraft).success, false);

const migration = await readFile(new URL("../supabase/migrations/032_grant_document_foundation.sql", import.meta.url), "utf8");
assert.match(migration, /FOR UPDATE;/);
assert.match(migration, /current_revision_id IS DISTINCT FROM p_expected_revision_id/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/g);
assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE).* TO authenticated/);
assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE).*grant_(?:documents|document_revisions|template_snapshots|audit_events).* TO service_role/);
assert.match(migration, /BEFORE UPDATE ON public\.grant_document_revisions/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_grant_document_aggregate/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.list_grant_audit_events/);

const rpcCalls: Array<{ name: string; arguments_: Record<string, unknown> }> = [];
const rpcClient = {
  rpc(name: string, arguments_: Record<string, unknown>) {
    rpcCalls.push({ name, arguments_ });
    if (name === "get_grant_document_aggregate") {
      return Promise.resolve({ data: created, error: null });
    }
    if (name === "list_grant_audit_events") {
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: true, error: null });
  },
};
const supabaseRepository = new SupabaseGrantRevisionRepository(rpcClient, ownerId);
assert.equal((await supabaseRepository.get(created.document.documentId))?.document.documentId, created.document.documentId);
assert.deepEqual(await supabaseRepository.listAuditEvents(created.document.documentId), []);
assert.deepEqual(rpcCalls.map((call) => call.name), ["get_grant_document_aggregate", "list_grant_audit_events"]);

console.log("Grant foundation contract tests passed.");
