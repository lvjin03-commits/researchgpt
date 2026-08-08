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

const cleanupPreviousVerificationUsers = async () => {
  let page = 1;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Temporary user discovery failed: ${error.message}`);
    const users = data?.users ?? [];
    for (const user of users) {
      if (user.user_metadata?.purpose !== "grant-diagnostics-postgres-verification") continue;
      const { error: documentError } = await client.from("grant_documents").delete().eq("owner_id", user.id);
      if (documentError) throw new Error(`Previous temporary document cleanup failed: ${documentError.message}`);
      const { error: userError } = await client.auth.admin.deleteUser(user.id);
      if (userError) throw new Error(`Previous temporary user cleanup failed: ${userError.message}`);
    }
    if (users.length < 100) return;
    page += 1;
  }
};

await cleanupPreviousVerificationUsers();

const runTag = `${Date.now()}-${randomUUID()}`;
let ownerId;
let otherOwnerId;
let documentId;
let templateSnapshotId;
try {
  const createUser = async (prefix) => {
    const { data, error } = await client.auth.admin.createUser({
      email: `${prefix}-${runTag}@example.com`, password: `Gd-${randomUUID()}-aA1!`, email_confirm: true,
      user_metadata: { purpose: "grant-diagnostics-postgres-verification", runTag },
    });
    if (error || !data.user) throw new Error(`Temporary user creation failed: ${error?.message ?? "missing user"}`);
    return data.user.id;
  };
  ownerId = await createUser("grant-diagnostics-owner");
  otherOwnerId = await createUser("grant-diagnostics-other");
  documentId = randomUUID();
  templateSnapshotId = randomUUID();
  const revisionId = randomUUID();
  const sectionId = randomUUID();
  const nodeId = randomUUID();
  const snapshot = {
    schemaVersion: "grant-canonical-v1", title: "Diagnostic PostgreSQL verification",
    sections: [{ sectionId, semanticRole: "background", title: "研究背景", order: 0, nodeIds: [nodeId] }],
    nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "待补充" } }],
  };
  await rpc("create_grant_document_foundation", {
    p_owner_id: ownerId, p_document_id: documentId, p_title: snapshot.title,
    p_template_snapshot_id: templateSnapshotId, p_template_key: "nsfc-diagnostic-verification",
    p_template_version: "1", p_template_rules: {}, p_template_checksum: digest({}),
    p_revision_id: revisionId, p_content_hash: digest(snapshot), p_snapshot: snapshot,
    p_actor_id: ownerId, p_audit_event_id: randomUUID(), p_audit_metadata: { runTag },
  });

  const checkerRunId = randomUUID();
  const findingId = randomUUID();
  const timestamp = new Date().toISOString();
  const checkerRun = {
    runId: checkerRunId, documentId, sourceRevisionId: revisionId,
    checkerId: "grant.structural_completeness", checkerVersion: "1.0.0", contractVersion: "grant-checker-v1",
    inputMode: "full_document", inputNodeIds: [nodeId], inputHash: digest({ revisionId, nodeId }),
    status: "succeeded", parsedOutput: { findingCount: 1 }, createdBy: ownerId,
    startedAt: timestamp, completedAt: timestamp,
  };
  const finding = {
    findingId, runId: checkerRunId, documentId, sourceRevisionId: revisionId,
    checkerId: checkerRun.checkerId, checkerVersion: checkerRun.checkerVersion,
    fingerprint: digest({ checkerRunId, nodeId }), code: "placeholder_content",
    message: "该位置仍包含占位内容。", recommendation: "替换为成熟文本。",
    assessment: { scope: "paragraph", confidence: 1, actionability: "directly_actionable" },
    sourceAnchor: {
      sourceRevisionId: revisionId, locationStatus: "located", sectionId, nodeId, nodeType: "paragraph",
      sectionRole: "background", heading: "研究背景", text: "待补充", textHash: digest("待补充"),
      previousText: "", nextText: "", startOffset: 0, endOffset: 3,
    },
    lifecycleStatus: "open", createdAt: timestamp,
  };
  assert(await rpc("save_grant_diagnostic_execution", {
    p_owner_id: ownerId, p_document_id: documentId, p_runs: [checkerRun], p_findings: [finding], p_conflicts: [],
  }) === true, "Diagnostic execution was not persisted.");
  const findings = await rpc("list_grant_findings", { p_owner_id: ownerId, p_document_id: documentId });
  assert(findings.length === 1 && findings[0].findingId === findingId, "Owner could not read persisted Finding.");
  const unauthorizedFindings = await rpc("list_grant_findings", { p_owner_id: otherOwnerId, p_document_id: documentId });
  assert(Array.isArray(unauthorizedFindings) && unauthorizedFindings.length === 0, "Another owner could read Findings.");

  const rolledBackRunId = randomUUID();
  let atomicFailureObserved = false;
  try {
    await rpc("save_grant_diagnostic_execution", {
      p_owner_id: ownerId, p_document_id: documentId,
      p_runs: [{ ...checkerRun, runId: rolledBackRunId, inputHash: digest(rolledBackRunId) }],
      p_findings: [{ ...finding, findingId: randomUUID(), runId: rolledBackRunId, documentId: randomUUID() }],
      p_conflicts: [],
    });
  } catch {
    atomicFailureObserved = true;
  }
  assert(atomicFailureObserved, "Invalid diagnostic execution was not rejected.");
  const { count, error: countError } = await client.from("grant_diagnostic_runs").select("run_id", { count: "exact", head: true }).eq("run_id", rolledBackRunId);
  if (countError) throw new Error(`Atomic rollback verification failed: ${countError.message}`);
  assert(count === 0, "Failed diagnostic execution left a partial checker run.");

  console.log(JSON.stringify({ migration: "036_grant_diagnostics", findingPersisted: true, ownerIsolationVerified: true, atomicRollbackVerified: true }, null, 2));
} finally {
  if (documentId) {
    const { error } = await client.from("grant_documents").delete().eq("document_id", documentId);
    if (error) throw new Error(`Temporary document cleanup failed: ${error.message}`);
  }
  for (const userId of [ownerId, otherOwnerId].filter(Boolean)) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Temporary user cleanup failed: ${error.message}`);
  }
  if (documentId) {
    for (const table of ["grant_diagnostic_runs", "grant_findings", "grant_diagnostic_conflicts", "grant_documents"]) {
      const column = table === "grant_diagnostic_runs" || table === "grant_findings" || table === "grant_diagnostic_conflicts" ? "document_id" : "document_id";
      const { count, error } = await client.from(table).select(column, { count: "exact", head: true }).eq(column, documentId);
      if (error) throw new Error(`Cleanup verification failed for ${table}: ${error.message}`);
      assert(count === 0, `Temporary rows remain in ${table}.`);
    }
  }
  console.log("Temporary grant diagnostic users and rows were removed.");
}
