import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const rpc = async (name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
};

const runId = `${Date.now()}-${randomUUID()}`;
const email = `grant-editor-${runId}@example.com`;
const password = `Ge-${randomUUID()}-aA1!`;
let userId;
let documentId;
let templateSnapshotId;

try {
  const { data: createdUser, error: createUserError } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "grant-editor-postgres-verification", runId },
  });
  if (createUserError || !createdUser.user) {
    throw new Error(`Temporary auth user creation failed: ${createUserError?.message ?? "missing user"}`);
  }
  userId = createdUser.user.id;

  documentId = randomUUID();
  templateSnapshotId = randomUUID();
  const initialRevisionId = randomUUID();
  const sectionId = randomUUID();
  const nodeId = randomUUID();
  const initialSnapshot = {
    schemaVersion: "grant-canonical-v1",
    title: "Grant editor PostgreSQL verification",
    sections: [{ sectionId, semanticRole: "project_basis", title: "立项依据", order: 0, nodeIds: [nodeId] }],
    nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "初始内容。" } }],
  };

  await rpc("create_grant_document_foundation", {
    p_owner_id: userId,
    p_document_id: documentId,
    p_title: initialSnapshot.title,
    p_template_snapshot_id: templateSnapshotId,
    p_template_key: "nsfc-editor-verification",
    p_template_version: "1",
    p_template_rules: { charactersPerPage: 1100, maximumEstimatedPages: 20 },
    p_template_checksum: digest({ charactersPerPage: 1100, maximumEstimatedPages: 20 }),
    p_revision_id: initialRevisionId,
    p_content_hash: digest(initialSnapshot),
    p_snapshot: initialSnapshot,
    p_actor_id: userId,
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { runId },
  });

  const documents = await rpc("list_grant_documents", { p_owner_id: userId });
  assert(Array.isArray(documents) && documents.length === 1, "Document list did not return the created document.");
  assert(documents[0].currentRevisionId === initialRevisionId, "Document list returned the wrong current revision.");

  const initialRevision = await rpc("get_grant_document_revision", {
    p_owner_id: userId,
    p_document_id: documentId,
    p_revision_id: initialRevisionId,
  });
  assert(initialRevision?.snapshot?.title === initialSnapshot.title, "Initial revision snapshot could not be read.");

  const editedSnapshot = structuredClone(initialSnapshot);
  editedSnapshot.nodes[0].content.text = "自动保存后的正文内容。";
  const editedRevisionId = randomUUID();
  const autosaveCommitted = await rpc("commit_grant_document_revision", {
    p_owner_id: userId,
    p_document_id: documentId,
    p_expected_revision_id: initialRevisionId,
    p_revision_id: editedRevisionId,
    p_content_hash: digest(editedSnapshot),
    p_snapshot: editedSnapshot,
    p_actor_id: userId,
    p_actor_kind: "user",
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { runId, reason: "editor_autosave" },
  });
  assert(autosaveCommitted === true, "Autosave revision was not committed.");

  const staleCommitted = await rpc("commit_grant_document_revision", {
    p_owner_id: userId,
    p_document_id: documentId,
    p_expected_revision_id: initialRevisionId,
    p_revision_id: randomUUID(),
    p_content_hash: digest(editedSnapshot),
    p_snapshot: editedSnapshot,
    p_actor_id: userId,
    p_actor_kind: "user",
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { runId, reason: "stale_editor_autosave" },
  });
  assert(staleCommitted === false, "A stale editor autosave overwrote the current revision.");

  const restoreRevisionId = randomUUID();
  const restored = await rpc("commit_grant_document_revision", {
    p_owner_id: userId,
    p_document_id: documentId,
    p_expected_revision_id: editedRevisionId,
    p_revision_id: restoreRevisionId,
    p_content_hash: digest(initialRevision.snapshot),
    p_snapshot: initialRevision.snapshot,
    p_actor_id: userId,
    p_actor_kind: "user",
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { runId, reason: "restore_revision", sourceRevisionId: initialRevisionId },
  });
  assert(restored === true, "Historical revision was not restored as a new revision.");

  const history = await rpc("list_grant_document_revisions", {
    p_owner_id: userId,
    p_document_id: documentId,
  });
  assert(Array.isArray(history), "Revision history is not an array.");
  assert(history.length === 3, `Expected three durable revisions, received ${history.length}.`);
  assert(history.map((revision) => revision.revisionNumber).join(",") === "3,2,1", "Revision history order is incorrect.");

  const restoredRevision = await rpc("get_grant_document_revision", {
    p_owner_id: userId,
    p_document_id: documentId,
    p_revision_id: restoreRevisionId,
  });
  assert(restoredRevision?.snapshot?.nodes?.[0]?.content?.text === "初始内容。", "Restored content does not match the selected history revision.");

  console.log(JSON.stringify({
    migration: "035_grant_editor_revision_reads",
    documentListCount: documents.length,
    autosaveCommitted,
    staleAutosaveRejected: staleCommitted === false,
    restoredAsNewRevision: restored,
    revisionNumbers: history.map((revision) => revision.revisionNumber),
    restoredContentVerified: true,
  }, null, 2));
} finally {
  if (userId) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Temporary auth user cleanup failed: ${error.message}`);
  }

  if (documentId && templateSnapshotId) {
    const checks = await Promise.all([
      client.from("grant_documents").select("document_id", { count: "exact", head: true }).eq("document_id", documentId),
      client.from("grant_document_revisions").select("revision_id", { count: "exact", head: true }).eq("document_id", documentId),
      client.from("grant_audit_events").select("audit_event_id", { count: "exact", head: true }).eq("document_id", documentId),
      client.from("grant_template_snapshots").select("template_snapshot_id", { count: "exact", head: true }).eq("template_snapshot_id", templateSnapshotId),
    ]);
    for (const check of checks) {
      if (check.error) throw new Error(`Cleanup verification failed: ${check.error.message}`);
      assert(check.count === 0, `Temporary verification rows remain after cleanup (count=${check.count}).`);
    }
    console.log("Temporary grant editor user and all verification rows were removed.");
  }
}
