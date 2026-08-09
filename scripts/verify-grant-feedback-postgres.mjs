import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server configuration is required.");
const client = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rpc = async (name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
};

const cleanupVerificationUsers = async () => {
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Temporary user discovery failed: ${error.message}`);
    const users = data?.users ?? [];
    for (const user of users) {
      if (user.user_metadata?.purpose !== "grant-feedback-postgres-verification") continue;
      const { error: documentError } = await client.from("grant_documents").delete().eq("owner_id", user.id);
      if (documentError) throw new Error(`Previous temporary document cleanup failed: ${documentError.message}`);
      const { error: userError } = await client.auth.admin.deleteUser(user.id);
      if (userError) throw new Error(`Previous temporary user cleanup failed: ${userError.message}`);
    }
    if (users.length < 100) return;
    page += 1;
  }
};

await cleanupVerificationUsers();

const runTag = `${Date.now()}-${randomUUID()}`;
let ownerId;
let otherOwnerId;
let documentId;
try {
  const createUser = async (prefix) => {
    const { data, error } = await client.auth.admin.createUser({
      email: `${prefix}-${runTag}@example.com`,
      password: `Gf-${randomUUID()}-aA1!`,
      email_confirm: true,
      user_metadata: { purpose: "grant-feedback-postgres-verification", runTag },
    });
    if (error || !data.user) throw new Error(`Temporary user creation failed: ${error?.message ?? "missing user"}`);
    return data.user.id;
  };

  ownerId = await createUser("grant-feedback-owner");
  otherOwnerId = await createUser("grant-feedback-other");
  documentId = randomUUID();
  const revisionId = randomUUID();
  const sectionId = randomUUID();
  const nodeId = randomUUID();
  const snapshot = {
    schemaVersion: "grant-canonical-v1",
    title: "Grant feedback PostgreSQL verification",
    sections: [{ sectionId, semanticRole: "background", title: "Research background", order: 0, nodeIds: [nodeId] }],
    nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "Placeholder content" } }],
  };
  await rpc("create_grant_document_foundation", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_title: snapshot.title,
    p_template_snapshot_id: randomUUID(),
    p_template_key: "nsfc-feedback-verification",
    p_template_version: "1",
    p_template_rules: {},
    p_template_checksum: digest({}),
    p_revision_id: revisionId,
    p_content_hash: digest(snapshot),
    p_snapshot: snapshot,
    p_actor_id: ownerId,
    p_audit_event_id: randomUUID(),
    p_audit_metadata: { runTag },
  });

  const runId = randomUUID();
  const findingId = randomUUID();
  const timestamp = new Date().toISOString();
  await rpc("save_grant_diagnostic_execution", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_runs: [{
      runId,
      documentId,
      sourceRevisionId: revisionId,
      checkerId: "grant.structural_completeness",
      checkerVersion: "1.0.0",
      contractVersion: "grant-checker-v1",
      inputMode: "full_document",
      inputNodeIds: [nodeId],
      inputHash: digest({ revisionId, nodeId }),
      status: "succeeded",
      parsedOutput: { findingCount: 1 },
      createdBy: ownerId,
      startedAt: timestamp,
      completedAt: timestamp,
    }],
    p_findings: [{
      findingId,
      runId,
      documentId,
      sourceRevisionId: revisionId,
      checkerId: "grant.structural_completeness",
      checkerVersion: "1.0.0",
      fingerprint: digest({ runId, nodeId }),
      code: "placeholder_content",
      message: "Placeholder content remains.",
      recommendation: "Replace it with mature content.",
      assessment: { scope: "paragraph", confidence: 1, actionability: "directly_actionable" },
      sourceAnchor: {
        sourceRevisionId: revisionId,
        locationStatus: "located",
        sectionId,
        nodeId,
        nodeType: "paragraph",
        sectionRole: "background",
        heading: "Research background",
        text: "Placeholder content",
        textHash: digest("Placeholder content"),
        previousText: "",
        nextText: "",
        startOffset: 0,
        endOffset: 19,
      },
      lifecycleStatus: "open",
      createdAt: timestamp,
    }],
    p_conflicts: [],
  });

  const saved = await rpc("set_grant_finding_feedback", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_finding_id: findingId,
    p_disposition: "deferred",
    p_actor_id: ownerId,
  });
  assert(saved.findingId === findingId && saved.disposition === "deferred", "Feedback was not persisted.");
  const ownerFeedback = await rpc("list_grant_finding_feedback", { p_owner_id: ownerId, p_document_id: documentId });
  assert(ownerFeedback.length === 1 && ownerFeedback[0].findingId === findingId, "Owner could not read feedback.");
  const otherFeedback = await rpc("list_grant_finding_feedback", { p_owner_id: otherOwnerId, p_document_id: documentId });
  assert(Array.isArray(otherFeedback) && otherFeedback.length === 0, "Another owner could read feedback.");
  let unauthorizedWriteRejected = false;
  try {
    await rpc("set_grant_finding_feedback", {
      p_owner_id: otherOwnerId,
      p_document_id: documentId,
      p_finding_id: findingId,
      p_disposition: "ignored",
      p_actor_id: otherOwnerId,
    });
  } catch {
    unauthorizedWriteRejected = true;
  }
  assert(unauthorizedWriteRejected, "Another owner could overwrite feedback.");
  const findings = await rpc("list_grant_findings", { p_owner_id: ownerId, p_document_id: documentId });
  assert(findings[0]?.lifecycleStatus === "open", "Feedback changed the immutable Finding lifecycle.");

  console.log(JSON.stringify({
    migration: "038_grant_finding_feedback",
    feedbackPersisted: true,
    ownerIsolationVerified: true,
    findingConclusionUnchanged: true,
  }, null, 2));
} finally {
  if (documentId) {
    const { error } = await client.from("grant_documents").delete().eq("document_id", documentId);
    if (error) throw new Error(`Temporary document cleanup failed: ${error.message}`);
  }
  for (const userId of [ownerId, otherOwnerId].filter(Boolean)) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Temporary user cleanup failed: ${error.message}`);
  }
  console.log("Temporary grant feedback users and rows were removed.");
}
