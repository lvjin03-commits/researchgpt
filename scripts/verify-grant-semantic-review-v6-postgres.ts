import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import { buildGrantSemanticDiagnosticV3Input } from "../lib/grants/diagnostics/semantic-v3-input.ts";
import { buildGrantHierarchicalDiagnosticPreparedInputV1 } from "../lib/grants/diagnostics/hierarchical-semantic-input.ts";
import { buildGrantSemanticReviewV6PreparedInputV1 } from "../lib/grants/diagnostics/semantic-review-v6-input.ts";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  GrantFactMapCoverageReportV1Schema,
  GrantFactMapV1Schema,
  GrantNarrativeFindingContentV1Schema,
  GrantScientificFindingContentV1Schema,
} from "../lib/grants/diagnostics/semantic-review-v6-contracts.ts";
import {
  assembleGrantSemanticReviewV6ExecutionForPersistence,
  createGrantSemanticReviewV6Checkpoint,
  GrantSemanticReviewV6CheckpointRecordSchema,
} from "../lib/grants/diagnostics/semantic-review-v6-persistence.ts";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server configuration is required.");

const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
};

const runTag = `${Date.now()}-${randomUUID()}`;
let ownerId: string | undefined;
let otherOwnerId: string | undefined;
let documentId: string | undefined;
let templateSnapshotId: string | undefined;

try {
  const createUser = async (prefix: string) => {
    const { data, error } = await client.auth.admin.createUser({
      email: `${prefix}-${runTag}@example.com`,
      password: `Gv6-${randomUUID()}-aA1!`,
      email_confirm: true,
      user_metadata: { purpose: "grant-semantic-review-v6-postgres-verification", runTag },
    });
    if (error || !data.user) throw new Error(`Temporary user creation failed: ${error?.message ?? "missing user"}`);
    return data.user.id;
  };

  ownerId = await createUser("grant-v6-owner");
  otherOwnerId = await createUser("grant-v6-other");
  documentId = randomUUID();
  templateSnapshotId = randomUUID();
  const revisionId = randomUUID();
  const sectionId = randomUUID();
  const firstNodeId = randomUUID();
  const secondNodeId = randomUUID();
  const snapshot: CanonicalGrantSnapshot = {
    schemaVersion: "grant-canonical-v1",
    title: "Semantic Review V6 PostgreSQL verification",
    sections: [{ sectionId, semanticRole: "rationale", title: "Rationale", order: 0, nodeIds: [firstNodeId, secondNodeId] }],
    nodes: [
      { nodeId: firstNodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "A scientific question is stated." } },
      { nodeId: secondNodeId, sectionId, order: 1, nodeType: "paragraph", content: { text: "The proposed route does not state a decision criterion." } },
    ],
  };
  await rpc("create_grant_document_foundation", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_title: snapshot.title,
    p_template_snapshot_id: templateSnapshotId,
    p_template_key: "nsfc-v6-verification",
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

  const prepared = buildGrantSemanticReviewV6PreparedInputV1({
    prepared: buildGrantHierarchicalDiagnosticPreparedInputV1({
      sourceRevisionId: revisionId,
      prepared: buildGrantSemanticDiagnosticV3Input({
        snapshot,
        inputMode: "full_document",
        inputSectionIds: [sectionId],
        inputNodeIds: [firstNodeId, secondNodeId],
        fundingCategory: "Young Scientists Fund",
        evidenceCards: [],
        priorFindings: [],
      }),
    }),
  });
  const factMap = GrantFactMapV1Schema.parse({
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapSchemaVersion,
    sourceRevisionId: revisionId,
    locationScopeFingerprint: prepared.locationScopeFingerprint,
    semanticObjects: [{
      schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.semanticObjectSchemaVersion,
      sourceRevisionId: revisionId,
      semanticObjectRef: "S1",
      objectType: "scientific_question",
      normalizedFacet: "question_route",
      anchors: [{ sourceRevisionId: revisionId, sectionId, nodeId: firstNodeId, startOffset: 0, endOffset: 32, anchorHash: "a".repeat(64) }],
    }],
  });
  const scientificFinding = GrantScientificFindingContentV1Schema.parse({
    findingRef: "F1",
    category: "objective_content_route_gap",
    semanticObjectRefs: ["S1"],
    title: "Question and route are not connected",
    diagnosticFact: "The route lacks a decision criterion.",
    existingDesign: [{ sectionId, nodeId: firstNodeId, summary: "The question is stated.", evidenceTier: "description_only" }],
    residualGap: "No criterion connects the route to the question.",
    reasonExistingDesignIsInsufficient: "A stated question alone does not define verification.",
    recommendation: "Add an observable criterion and decision rule.",
    possibleReviewerQuestion: null,
    assessment: { scope: "cross_section", confidence: 0.9, actionability: "requires_expert_judgment" },
    primaryLocation: { sectionId, nodeId: secondNodeId },
    relatedLocations: [],
    evidenceBasis: "document_only",
    usedEvidenceCardIds: [],
  });
  const coverageReport = GrantFactMapCoverageReportV1Schema.parse({
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapCoverageSchemaVersion,
    sourceRevisionId: revisionId,
    coverageItems: [{ semanticObjectRef: "S1", objectType: "scientific_question", disposition: "residual_gap_found", findingRefs: ["F1"], unableToVerifyReason: null }],
  });
  const narrativeFinding = GrantNarrativeFindingContentV1Schema.parse({
    findingRef: "F2",
    category: "narrative_flow",
    title: "The transition is abrupt",
    observedPresentation: "The question and route appear in adjacent paragraphs without a bridge.",
    readerFriction: "The reader must infer the connection.",
    suggestedOrganization: "Add one transition sentence before the route.",
    affectedScope: "paragraph",
    assessment: { scope: "paragraph", confidence: 0.85, actionability: "directly_actionable" },
    primaryLocation: { sectionId, nodeId: secondNodeId },
    relatedLocations: [],
    usedFigureAssetIds: [],
  });

  const checkpoint = createGrantSemanticReviewV6Checkpoint({
    documentId,
    checkerId: "grant-semantic-review",
    prepared,
    checkpoint: { sourceRevisionId: revisionId, inputFingerprint: prepared.inputFingerprint, locationScopeFingerprint: prepared.locationScopeFingerprint, factMap },
  });
  const saveCheckpoint = async (requestedOwnerId: string, payload: typeof checkpoint) => GrantSemanticReviewV6CheckpointRecordSchema.parse(
    await rpc("save_grant_semantic_review_v6_checkpoint", { p_owner_id: requestedOwnerId, p_checkpoint: payload }),
  );
  const findCheckpoint = async (requestedOwnerId: string, query: {
    documentId: string;
    sourceRevisionId: string;
    checkerId: string;
    checkerVersion: string;
    inputFingerprint: string;
    locationScopeFingerprint: string;
  }) => {
    const data = await rpc("find_grant_semantic_review_v6_checkpoint", {
      p_owner_id: requestedOwnerId,
      p_document_id: query.documentId,
      p_source_revision_id: query.sourceRevisionId,
      p_checker_id: query.checkerId,
      p_checker_version: query.checkerVersion,
      p_input_fingerprint: query.inputFingerprint,
      p_location_scope_fingerprint: query.locationScopeFingerprint,
    });
    return data ? GrantSemanticReviewV6CheckpointRecordSchema.parse(data) : null;
  };
  const savedCheckpoint = await saveCheckpoint(ownerId, checkpoint);
  const lookup = {
    documentId,
    sourceRevisionId: revisionId,
    checkerId: checkpoint.checkerId,
    checkerVersion: checkpoint.checkerVersion,
    inputFingerprint: checkpoint.inputFingerprint,
    locationScopeFingerprint: checkpoint.locationScopeFingerprint,
  };
  assert.equal((await findCheckpoint(ownerId, lookup))?.checkpointId, savedCheckpoint.checkpointId);
  assert.equal(await findCheckpoint(otherOwnerId, lookup), null, "Another owner read a V6 checkpoint.");

  let staleRejected = false;
  const staleRevisionId = randomUUID();
  try {
    await rpc("save_grant_semantic_review_v6_checkpoint", {
      p_owner_id: ownerId,
      p_checkpoint: {
        ...checkpoint,
        checkpointId: randomUUID(),
        sourceRevisionId: staleRevisionId,
        factMap: { ...checkpoint.factMap, sourceRevisionId: staleRevisionId },
      },
    });
  } catch (error) {
    staleRejected = /diagnostic_base_revision_stale/.test(String(error));
  }
  assert.equal(staleRejected, true, "A stale V6 Revision was not rejected.");

  const execution = assembleGrantSemanticReviewV6ExecutionForPersistence({
    documentId,
    actorId: ownerId,
    checkerId: checkpoint.checkerId,
    snapshot,
    prepared,
    execution: {
      factMap,
      scientificFindings: [scientificFinding],
      coverageReport,
      narrativeFindings: [narrativeFinding],
      providerCallCount: 3,
      completionTokenAllocation: 26_000,
      usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 100 },
      stages: [
        { stage: "fact_mapping", status: "succeeded", attemptCount: 1, failureCode: null },
        { stage: "scientific_review", status: "succeeded", attemptCount: 1, failureCode: null },
        { stage: "narrative_review", status: "succeeded", attemptCount: 1, failureCode: null },
      ],
      resumedFrom: "none",
      imageCoverage: { mode: "text_only" },
    },
    checkpointId: checkpoint.checkpointId,
    startedAt: new Date(Date.now() - 1000).toISOString(),
    completedAt: new Date().toISOString(),
  });

  const rollbackRunId = randomUUID();
  let rollbackObserved = false;
  try {
    await rpc("save_grant_semantic_review_v6_execution", {
      p_owner_id: ownerId,
      p_document_id: documentId,
      p_run: { ...execution.run, runId: rollbackRunId },
      p_findings: execution.findings.map((finding) => ({ ...finding, runId: rollbackRunId })),
      p_finding_details: execution.findingDetails.map((detail, index) => index === 0 ? { ...detail, findingId: randomUUID() } : detail),
      p_checkpoint: execution.checkpoint,
    });
  } catch (error) {
    rollbackObserved = /Finding detail mismatch/.test(String(error));
  }
  assert.equal(rollbackObserved, true, "An invalid V6 detail did not fail the transaction.");
  const { count: partialRunCount, error: partialRunError } = await client.from("grant_diagnostic_runs")
    .select("run_id", { count: "exact", head: true }).eq("run_id", rollbackRunId);
  if (partialRunError) throw partialRunError;
  assert.equal(partialRunCount, 0, "Failed V6 transaction left a partial run.");

  assert.equal(await rpc("save_grant_semantic_review_v6_execution", {
    p_owner_id: ownerId,
    p_document_id: documentId,
    p_run: execution.run,
    p_findings: execution.findings,
    p_finding_details: execution.findingDetails,
    p_checkpoint: execution.checkpoint,
  }), true, "V6 execution was not persisted.");
  assert.equal(await findCheckpoint(ownerId, lookup), null, "Successful V6 save did not consume its checkpoint.");
  const { count: findingCount, error: findingError } = await client.from("grant_findings")
    .select("finding_id", { count: "exact", head: true }).eq("run_id", execution.run.runId);
  if (findingError) throw findingError;
  assert.equal(findingCount, 2, "Both V6 Finding families were not persisted.");
  const { count: detailCount, error: detailError } = await client.from("grant_semantic_review_v6_finding_details")
    .select("finding_id", { count: "exact", head: true }).in("finding_id", execution.findings.map((finding) => finding.findingId));
  if (detailError) throw detailError;
  assert.equal(detailCount, 2, "Both V6 Finding details were not persisted.");

  console.log(JSON.stringify({
    migration051: true,
    checkpointRoundTrip: true,
    ownerIsolation: true,
    staleRevisionRejected: true,
    atomicRollback: true,
    atomicSuccess: true,
    findingFamiliesPersisted: ["scientific", "narrative"],
  }, null, 2));
} finally {
  if (documentId) await client.from("grant_documents").delete().eq("document_id", documentId);
  if (templateSnapshotId) await client.from("grant_template_snapshots").delete().eq("template_snapshot_id", templateSnapshotId);
  for (const userId of [ownerId, otherOwnerId].filter((value): value is string => Boolean(value))) {
    await client.auth.admin.deleteUser(userId);
  }
}
