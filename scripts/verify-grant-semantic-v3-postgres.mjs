import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import { GrantSemanticDiagnosticChecker } from "../lib/grants/application/semantic-diagnostic-checker.ts";
import { GRANT_SEMANTIC_FINDING_V3_SCHEMA_VERSION } from "../lib/grants/diagnostics/semantic-v3-assembler.ts";
import {
  GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
} from "../lib/grants/ports/grant-diagnostic-model.ts";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration is required.");
const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const productionChecker = new GrantSemanticDiagnosticChecker({}, "gpt-5.5", "v3");
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rpc = async (name, args) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
};

const runTag = `${Date.now()}-${randomUUID()}`;
let ownerId;
let otherOwnerId;
let documentId;
try {
  const createUser = async (prefix) => {
    const { data, error } = await client.auth.admin.createUser({
      email: `${prefix}-${runTag}@example.com`,
      password: `Gv3-${randomUUID()}-aA1!`,
      email_confirm: true,
      user_metadata: { purpose: "grant-semantic-v3-postgres-verification", runTag },
    });
    if (error || !data.user) throw new Error(`Temporary user creation failed: ${error?.message ?? "missing user"}`);
    return data.user.id;
  };
  ownerId = await createUser("grant-v3-owner");
  otherOwnerId = await createUser("grant-v3-other");
  documentId = randomUUID();
  const revisionId = randomUUID();
  const sectionId = randomUUID();
  const nodeId = randomUUID();
  const templateSnapshotId = randomUUID();
  const snapshot = {
    schemaVersion: "grant-canonical-v1",
    title: "Semantic V3 PostgreSQL verification",
    sections: [{ sectionId, semanticRole: "basis", title: "Research basis", order: 0, nodeIds: [nodeId] }],
    nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "The background moves directly to the method." } }],
  };
  await rpc("create_grant_document_foundation", {
    p_owner_id: ownerId, p_document_id: documentId, p_title: snapshot.title,
    p_template_snapshot_id: templateSnapshotId, p_template_key: "nsfc-v3-verification",
    p_template_version: "1", p_template_rules: {}, p_template_checksum: digest({}),
    p_revision_id: revisionId, p_content_hash: digest(snapshot), p_snapshot: snapshot,
    p_actor_id: ownerId, p_audit_event_id: randomUUID(), p_audit_metadata: { runTag },
  });

  const timestamp = new Date().toISOString();
  const runId = randomUUID();
  const findingId = randomUUID();
  const run = {
    runId, documentId, sourceRevisionId: revisionId,
    checkerId: productionChecker.checkerId, checkerVersion: productionChecker.checkerVersion,
    contractVersion: productionChecker.contractVersion, inputMode: "full_document",
    inputNodeIds: [nodeId], inputHash: digest({ revisionId, nodeId }), status: "succeeded",
    parsedOutput: { findingCount: 1 }, createdBy: ownerId, startedAt: timestamp, completedAt: timestamp,
  };
  const sourceAnchor = {
    sourceRevisionId: revisionId, locationStatus: "located", sectionId, nodeId,
    nodeType: "paragraph", sectionRole: "basis", heading: "Research basis",
    text: snapshot.nodes[0].content.text, textHash: digest(snapshot.nodes[0].content.text),
    previousText: "", nextText: "",
  };
  const finding = {
    findingId, runId, documentId, sourceRevisionId: revisionId,
    checkerId: run.checkerId, checkerVersion: run.checkerVersion,
    contractVersion: run.contractVersion, schemaVersion: GRANT_SEMANTIC_FINDING_V3_SCHEMA_VERSION,
    policyVersion: GRANT_DIAGNOSTIC_V3_POLICY_VERSION, fingerprint: digest({ nodeId, fact: "argument gap" }),
    displayOrder: 0, category: "argument_chain_gap", title: "Missing inference",
    diagnosticFact: "The background moves directly from a limitation to the proposed method.",
    reason: "The connecting inference is not stated.", recommendation: "State the connecting inference.",
    possibleConsequence: null,
    assessment: { scope: "paragraph", confidence: 0.8, actionability: "directly_actionable" },
    primaryLocation: { sectionId, nodeId }, sourceAnchor,
    relatedLocations: [], usedEvidenceCardIds: [], lifecycleStatus: "open", createdAt: timestamp,
  };

  assert(await rpc("save_grant_semantic_v3_execution", {
    p_owner_id: ownerId, p_document_id: documentId, p_run: run, p_findings: [finding],
  }) === true, "V3 execution was not persisted.");
  const legacy = await rpc("list_grant_findings", { p_owner_id: ownerId, p_document_id: documentId });
  assert(legacy.length === 1 && legacy[0].findingId === findingId, "Compatibility Finding is unreadable.");
  const normalized = await rpc("list_grant_normalized_findings", { p_owner_id: ownerId, p_document_id: documentId });
  assert(normalized.length === 1 && normalized[0].schemaVersion === GRANT_SEMANTIC_FINDING_V3_SCHEMA_VERSION, "Normalized V3 projection is unreadable.");
  assert(normalized[0].reason === finding.reason, "Normalized V3 content was lost.");
  const unauthorized = await rpc("list_grant_normalized_findings", { p_owner_id: otherOwnerId, p_document_id: documentId });
  assert(Array.isArray(unauthorized) && unauthorized.length === 0, "Another owner could read V3 findings.");

  const rollbackRunId = randomUUID();
  let rollbackObserved = false;
  try {
    await rpc("save_grant_semantic_v3_execution", {
      p_owner_id: ownerId, p_document_id: documentId,
      p_run: { ...run, runId: rollbackRunId, inputHash: digest(rollbackRunId) },
      p_findings: [{ ...finding, findingId: randomUUID(), runId: rollbackRunId, category: "invalid_category" }],
    });
  } catch {
    rollbackObserved = true;
  }
  assert(rollbackObserved, "Invalid V3 content was not rejected.");
  const { count, error } = await client.from("grant_diagnostic_runs")
    .select("run_id", { count: "exact", head: true }).eq("run_id", rollbackRunId);
  if (error) throw new Error(`Rollback verification failed: ${error.message}`);
  assert(count === 0, "Failed V3 transaction left a partial base run.");

  console.log(JSON.stringify({
    migration: "046_grant_semantic_atomic_location_refs",
    compatibilityRead: true, normalizedRead: true, ownerIsolation: true, atomicRollback: true,
  }, null, 2));
} finally {
  if (documentId) await client.from("grant_documents").delete().eq("document_id", documentId);
  for (const userId of [ownerId, otherOwnerId].filter(Boolean)) await client.auth.admin.deleteUser(userId);
}
