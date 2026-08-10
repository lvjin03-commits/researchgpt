import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import { buildGrantSemanticDiagnosticV3Input } from "../lib/grants/diagnostics/semantic-v3-input.ts";
import { buildGrantHierarchicalDiagnosticPreparedInputV1 } from "../lib/grants/diagnostics/hierarchical-semantic-input.ts";
import { GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS, GrantArgumentRoleSchema, GrantArgumentMapV1Schema } from "../lib/grants/diagnostics/hierarchical-semantic-contracts.ts";
import { assembleGrantHierarchicalExecutionForPersistenceV1, createGrantArgumentMapCheckpointV1, grantHierarchicalDiagnosticInputFingerprintV1 } from "../lib/grants/diagnostics/hierarchical-diagnostic-persistence.ts";
import { assembleGrantHierarchicalFindingsV1 } from "../lib/grants/diagnostics/hierarchical-finding-assembler.ts";
import { InMemoryGrantDiagnosticRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-diagnostic-repository.ts";

const documentId = randomUUID();
const sourceRevisionId = randomUUID();
const actorId = randomUUID();
const sectionId = randomUUID();
const firstNodeId = randomUUID();
const secondNodeId = randomUUID();
const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "NSFC application",
  sections: [{ sectionId, semanticRole: "rationale", title: "Rationale", order: 0, nodeIds: [firstNodeId, secondNodeId] }],
  nodes: [
    { nodeId: firstNodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "The knowledge gap is described." } },
    { nodeId: secondNodeId, sectionId, order: 1, nodeType: "paragraph", content: { text: "The route is listed without the missing inference." } },
  ],
};
const prepared = buildGrantHierarchicalDiagnosticPreparedInputV1({
  sourceRevisionId,
  prepared: buildGrantSemanticDiagnosticV3Input({
    snapshot,
    inputMode: "full_document",
    inputSectionIds: [sectionId],
    inputNodeIds: [firstNodeId, secondNodeId],
    fundingCategory: "Young Scientists Fund",
    evidenceCards: [],
    priorFindings: [],
  }),
});
const argumentMap = GrantArgumentMapV1Schema.parse({
  schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion,
  sourceRevisionId,
  modules: GrantArgumentRoleSchema.options.map((role) => ({
    role, presence: "explicit", statement: `${role} statement`, sourceLocations: [{ sectionId, nodeId: firstNodeId }],
  })),
  relations: [],
});
const rootDiagnosis = {
  rootFindings: [{
    category: "argument_chain_gap" as const,
    affectedArgumentRoles: ["knowledge_gap" as const, "scientific_question" as const],
    title: "The gap is not connected to the question",
    diagnosticFact: "The application lists a gap and a route without the connecting inference.",
    reason: "A reviewer cannot determine why the route answers the question.",
    recommendation: "Add the missing inference and its verification criterion.",
    possibleConsequence: null,
    assessment: { scope: "cross_section" as const, confidence: 0.9, actionability: "requires_expert_judgment" as const },
    occurrences: [
      { primaryLocation: { sectionId, nodeId: firstNodeId }, relatedLocations: [] },
      { primaryLocation: { sectionId, nodeId: secondNodeId }, relatedLocations: [] },
    ],
    evidenceBasis: "document_only" as const,
    usedEvidenceCardIds: [],
  }],
};

const runId = randomUUID();
const findingId = randomUUID();
const checkpointId = randomUUID();
const assembled = assembleGrantHierarchicalFindingsV1({
  runId, documentId, sourceRevisionId,
  checkerId: "grant-semantic-argument-diagnostic", checkerVersion: "5.0.0",
  snapshot, result: rootDiagnosis, createId: () => findingId, now: () => "2026-08-10T12:00:00.000Z",
});
assert.equal(assembled.length, 1);
assert.equal(assembled[0]!.occurrences.length, 2);
assert.equal(assembled[0]!.fingerprint, assembled[0]!.rootFingerprint);

const reworded = structuredClone(rootDiagnosis);
reworded.rootFindings[0]!.diagnosticFact = "Different wording for the same structural root issue.";
reworded.rootFindings[0]!.recommendation = "A different recommendation must not change continuity.";
const reassembled = assembleGrantHierarchicalFindingsV1({
  runId, documentId, sourceRevisionId,
  checkerId: "grant-semantic-argument-diagnostic", checkerVersion: "5.0.0",
  snapshot, result: reworded, createId: randomUUID, now: () => "2026-08-10T12:01:00.000Z",
});
assert.equal(reassembled[0]!.rootFingerprint, assembled[0]!.rootFingerprint,
  "model wording must not change root continuity");
assert.deepEqual(reassembled[0]!.occurrences.map((item) => item.occurrenceFingerprint),
  assembled[0]!.occurrences.map((item) => item.occurrenceFingerprint));

const checkpoint = createGrantArgumentMapCheckpointV1({
  documentId, checkerId: "grant-semantic-argument-diagnostic", checkerVersion: "5.0.0",
  prepared, argumentMap, checkpointId, now: () => "2026-08-10T12:00:00.000Z",
});
assert.equal(checkpoint.inputFingerprint, grantHierarchicalDiagnosticInputFingerprintV1(prepared));

const repository = new InMemoryGrantDiagnosticRepository();
await repository.saveArgumentMapCheckpoint!(checkpoint);
const lookup = {
  documentId, sourceRevisionId, checkerId: checkpoint.checkerId, checkerVersion: checkpoint.checkerVersion,
  inputFingerprint: checkpoint.inputFingerprint, locationScopeFingerprint: checkpoint.locationScopeFingerprint,
};
assert.equal((await repository.findArgumentMapCheckpoint!(lookup))?.checkpointId, checkpointId);
assert.equal(await repository.findArgumentMapCheckpoint!({ ...lookup, sourceRevisionId: randomUUID() }), null,
  "a checkpoint must not cross revision boundaries");

const execution = assembleGrantHierarchicalExecutionForPersistenceV1({
  documentId, actorId, checkerId: checkpoint.checkerId, checkerVersion: checkpoint.checkerVersion,
  snapshot, prepared,
  execution: {
    argumentMap, rootDiagnosis, providerCallCount: 2,
    usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 10 }, resumedFromArgumentMap: false,
  },
  runId, checkpointId, startedAt: "2026-08-10T12:00:00.000Z", completedAt: "2026-08-10T12:02:00.000Z",
  createId: () => findingId,
});
await repository.saveHierarchicalExecution!(execution);
const normalized = await repository.listNormalizedFindings!(documentId);
assert.equal(normalized.length, 1);
assert.equal(normalized[0]!.schemaVersion, "grant-semantic-finding-v4");
assert.equal(normalized[0]!.rootOccurrences.length, 2);
assert.deepEqual(normalized[0]!.affectedArgumentRoles, ["knowledge_gap", "scientific_question"]);
const repeatedExecution = assembleGrantHierarchicalExecutionForPersistenceV1({
  documentId, actorId, checkerId: checkpoint.checkerId, checkerVersion: checkpoint.checkerVersion,
  snapshot, prepared,
  execution: {
    argumentMap, rootDiagnosis, providerCallCount: 1,
    usage: { inputTokens: 50, outputTokens: 30, reasoningTokens: 5 }, resumedFromArgumentMap: true,
  },
  runId: randomUUID(), checkpointId: randomUUID(),
  startedAt: "2026-08-10T12:03:00.000Z", completedAt: "2026-08-10T12:04:00.000Z",
  createId: randomUUID,
  previousFindings: normalized,
});
assert.equal(repeatedExecution.continuityLinks.length, 1);
assert.equal(repeatedExecution.continuityLinks[0]!.match, "exact");
assert.equal(repeatedExecution.continuityLinks[0]!.previousFindingId, normalized[0]!.findingId);
assert.equal(await repository.findArgumentMapCheckpoint!(lookup), null,
  "a successful atomic save consumes the checkpoint");

const migration = readFileSync("supabase/migrations/047_grant_hierarchical_diagnostic_projection.sql", "utf8");
assert.match(migration, /save_grant_hierarchical_diagnostic_execution/);
assert.match(migration, /grant_semantic_finding_v4_occurrences/);
assert.match(migration, /grant_semantic_finding_v4_continuity/);
assert.match(migration, /list_grant_normalized_findings/);
assert.match(migration, /grant-semantic-diagnostic-v5/);
assert.match(migration, /diagnostic_base_revision_stale/);
const panel = readFileSync("components/grants/grant-diagnostics-panel.tsx", "utf8");
assert.match(panel, /finding\.rootOccurrences\.length > 1/);
assert.match(panel, /onNavigateNode\(occurrence\.primaryLocation\.nodeId/);

console.log("Grant hierarchical assembly, continuity, checkpoint and normalized persistence contracts passed.");
