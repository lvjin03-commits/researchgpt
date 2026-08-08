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
const rpc = async (name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const runId = `${Date.now()}-${randomUUID()}`;
const email = `grant-atomic-${runId}@example.com`;
const password = `Gf-${randomUUID()}-aA1!`;
let userId;
let documentId;
let templateSnapshotId;

try {
  const { data: existingUsers, error: listUsersError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listUsersError) throw new Error(`Temporary auth user preflight failed: ${listUsersError.message}`);
  const staleVerificationUsers = existingUsers.users.filter(
    (user) => user.user_metadata?.purpose === "grant-foundation-atomic-verification",
  );
  for (const staleUser of staleVerificationUsers) {
    const { error } = await client.auth.admin.deleteUser(staleUser.id);
    if (error) throw new Error(`Stale verification user cleanup failed: ${String(error.message)}`);
  }

  const { data: createdUser, error: createUserError } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { purpose: "grant-foundation-atomic-verification", runId },
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
    title: "Atomic verification document",
    sections: [{ sectionId, semanticRole: "verification", title: "Initial", order: 0, nodeIds: [nodeId] }],
    nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "Initial revision." } }],
  };

  await rpc("create_grant_document_foundation", {
    p_owner_id: userId,
    p_document_id: documentId,
    p_title: initialSnapshot.title,
    p_template_snapshot_id: templateSnapshotId,
    p_template_key: "atomic-verification",
    p_template_version: "1",
    p_template_rules: { testOnly: true },
    p_template_checksum: digest({ testOnly: true }),
    p_revision_id: initialRevisionId,
    p_content_hash: digest(initialSnapshot),
    p_snapshot: initialSnapshot,
    p_actor_id: userId,
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { runId },
  });

  const aggregateV1 = await rpc("get_grant_document_aggregate", {
    p_owner_id: userId,
    p_document_id: documentId,
  });
  assert(aggregateV1?.document?.currentRevisionId === initialRevisionId, "Initial revision was not published.");
  assert(aggregateV1?.document?.currentRevisionNumber === 1, "Initial revision number must be 1.");

  const candidates = ["A", "B"].map((label) => {
    const revisionId = randomUUID();
    const snapshot = {
      ...initialSnapshot,
      title: `Atomic winner ${label}`,
      nodes: [{ ...initialSnapshot.nodes[0], content: { text: `Concurrent candidate ${label}.` } }],
    };
    return {
      label,
      revisionId,
      args: {
        p_owner_id: userId,
        p_document_id: documentId,
        p_expected_revision_id: initialRevisionId,
        p_revision_id: revisionId,
        p_content_hash: digest(snapshot),
        p_snapshot: snapshot,
        p_actor_id: userId,
        p_actor_kind: "user",
        p_audit_event_id: randomUUID(),
        p_audit_metadata: { runId, candidate: label },
      },
    };
  });

  const results = await Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      committed: await rpc("commit_grant_document_revision", candidate.args),
    })),
  );
  const winners = results.filter((result) => result.committed === true);
  const conflicts = results.filter((result) => result.committed === false);
  assert(winners.length === 1, `Expected exactly one atomic winner, received ${winners.length}.`);
  assert(conflicts.length === 1, `Expected exactly one stale-revision conflict, received ${conflicts.length}.`);

  const aggregateV2 = await rpc("get_grant_document_aggregate", {
    p_owner_id: userId,
    p_document_id: documentId,
  });
  assert(aggregateV2?.document?.currentRevisionId === winners[0].revisionId, "Current revision is not the winning revision.");
  assert(aggregateV2?.document?.currentRevisionNumber === 2, "Concurrent commits created more than one revision.");

  const staleResult = await rpc("commit_grant_document_revision", {
    ...conflicts[0].args,
    p_revision_id: randomUUID(),
    p_audit_event_id: randomUUID(),
  });
  assert(staleResult === false, "A stale expected revision was accepted after the race.");

  const auditEvents = await rpc("list_grant_audit_events", {
    p_owner_id: userId,
    p_document_id: documentId,
  });
  assert(Array.isArray(auditEvents) && auditEvents.length === 2, "Audit log must contain create + one commit only.");

  console.log(JSON.stringify({
    migration: "032_grant_document_foundation",
    initialRevisionNumber: 1,
    concurrentCommitResults: results.map(({ label, committed }) => ({ label, committed })),
    finalRevisionNumber: aggregateV2.document.currentRevisionNumber,
    auditEventCount: auditEvents.length,
    staleCommitRejected: staleResult === false,
  }, null, 2));
} finally {
  if (userId) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Temporary auth user cleanup failed: ${String(error.message)}`);
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
      assert(check.count === 0, `Temporary database rows remain after cleanup (count=${check.count}).`);
    }
    console.log("Temporary auth user and all grant verification rows were removed.");
  }
}
