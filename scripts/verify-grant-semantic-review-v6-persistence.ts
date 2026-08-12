import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  toGrantSemanticReviewV6ExecutionCheckpoint,
} from "../lib/grants/diagnostics/semantic-review-v6-persistence.ts";
import { InMemoryGrantDiagnosticRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-diagnostic-repository.ts";

const documentId = randomUUID();
const sourceRevisionId = randomUUID();
const actorId = randomUUID();
const sectionId = randomUUID();
const firstNodeId = randomUUID();
const secondNodeId = randomUUID();
const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "Application",
  sections: [{ sectionId, semanticRole: "rationale", title: "Rationale", order: 0, nodeIds: [firstNodeId, secondNodeId] }],
  nodes: [
    { nodeId: firstNodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "A scientific question is stated." } },
    { nodeId: secondNodeId, sectionId, order: 1, nodeType: "paragraph", content: { text: "The proposed route does not state a decision criterion." } },
  ],
};
const prepared = buildGrantSemanticReviewV6PreparedInputV1({
  prepared: buildGrantHierarchicalDiagnosticPreparedInputV1({
    sourceRevisionId,
    prepared: buildGrantSemanticDiagnosticV3Input({
      snapshot, inputMode: "full_document", inputSectionIds: [sectionId],
      inputNodeIds: [firstNodeId, secondNodeId], fundingCategory: "Young Scientists Fund",
      evidenceCards: [], priorFindings: [],
    }),
  }),
});
const factMap = GrantFactMapV1Schema.parse({
  schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapSchemaVersion,
  sourceRevisionId,
  locationScopeFingerprint: prepared.locationScopeFingerprint,
  semanticObjects: [{
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.semanticObjectSchemaVersion,
    sourceRevisionId, semanticObjectRef: "S1", objectType: "scientific_question",
    normalizedFacet: "question_route",
    anchors: [{ sourceRevisionId, sectionId, nodeId: firstNodeId, startOffset: 0, endOffset: 32, anchorHash: "a".repeat(64) }],
  }],
});
const scientificFinding = GrantScientificFindingContentV1Schema.parse({
  findingRef: "F1", category: "objective_content_route_gap", semanticObjectRefs: ["S1"],
  title: "Question and route are not connected", diagnosticFact: "The route lacks a decision criterion.",
  existingDesign: [{ sectionId, nodeId: firstNodeId, summary: "The question is stated.", evidenceTier: "description_only" }],
  residualGap: "No criterion connects the route to the question.",
  reasonExistingDesignIsInsufficient: "A stated question alone does not define verification.",
  recommendation: "Add an observable criterion and decision rule.", possibleReviewerQuestion: null,
  assessment: { scope: "cross_section", confidence: 0.9, actionability: "requires_expert_judgment" },
  primaryLocation: { sectionId, nodeId: secondNodeId }, relatedLocations: [],
  evidenceBasis: "document_only", usedEvidenceCardIds: [],
});
const coverageReport = GrantFactMapCoverageReportV1Schema.parse({
  schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapCoverageSchemaVersion,
  sourceRevisionId,
  coverageItems: [{ semanticObjectRef: "S1", objectType: "scientific_question", disposition: "residual_gap_found", findingRefs: ["F1"], unableToVerifyReason: null }],
});
const narrativeFinding = GrantNarrativeFindingContentV1Schema.parse({
  findingRef: "F2", category: "narrative_flow", title: "The transition is abrupt",
  observedPresentation: "The question and route appear in adjacent paragraphs without a bridge.",
  readerFriction: "The reader must infer the connection.",
  suggestedOrganization: "Add one transition sentence before the route.", affectedScope: "paragraph",
  assessment: { scope: "paragraph", confidence: 0.85, actionability: "directly_actionable" },
  primaryLocation: { sectionId, nodeId: secondNodeId }, relatedLocations: [], usedFigureAssetIds: [],
});
const checkpointRecord = createGrantSemanticReviewV6Checkpoint({
  documentId, checkerId: "grant-semantic-review", prepared,
  checkpoint: { sourceRevisionId, inputFingerprint: prepared.inputFingerprint, locationScopeFingerprint: prepared.locationScopeFingerprint, factMap },
  checkpointId: randomUUID(), now: () => "2026-08-12T12:00:00.000Z",
});
assert.equal(checkpointRecord.matureStage, "fact_map");
assert.equal(toGrantSemanticReviewV6ExecutionCheckpoint(checkpointRecord).factMap.semanticObjects.length, 1);

const repository = new InMemoryGrantDiagnosticRepository();
await repository.saveSemanticReviewV6Checkpoint!(checkpointRecord);
const lookup = {
  documentId, sourceRevisionId, checkerId: checkpointRecord.checkerId,
  checkerVersion: checkpointRecord.checkerVersion, inputFingerprint: prepared.inputFingerprint,
  locationScopeFingerprint: prepared.locationScopeFingerprint,
};
assert.equal((await repository.findSemanticReviewV6Checkpoint!(lookup))?.checkpointId, checkpointRecord.checkpointId);
assert.equal(await repository.findSemanticReviewV6Checkpoint!({ ...lookup, sourceRevisionId: randomUUID() }), null);

const execution = assembleGrantSemanticReviewV6ExecutionForPersistence({
  documentId, actorId, checkerId: checkpointRecord.checkerId, snapshot, prepared,
  execution: {
    factMap, scientificFindings: [scientificFinding], coverageReport,
    narrativeFindings: [narrativeFinding], providerCallCount: 3, completionTokenAllocation: 26_000,
    usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 100 },
    stages: [
      { stage: "fact_mapping", status: "succeeded", attemptCount: 1, failureCode: null },
      { stage: "scientific_review", status: "succeeded", attemptCount: 1, failureCode: null },
      { stage: "narrative_review", status: "succeeded", attemptCount: 1, failureCode: null },
    ],
    resumedFrom: "none",
    imageCoverage: { mode: "text_only", candidateCount: 0, authorizedCount: 0, suppliedCount: 0, omittedCount: 0, reasons: ["no_figures_in_scope"], imageScopeFingerprint: "empty" },
  },
  runId: randomUUID(), checkpointId: checkpointRecord.checkpointId,
  startedAt: "2026-08-12T12:00:00.000Z", completedAt: "2026-08-12T12:02:00.000Z",
});
assert.equal(execution.findings.length, 2);
assert.deepEqual(execution.findingDetails.map((detail) => detail.family), ["scientific", "narrative"]);
assert.notEqual(execution.findings[0]!.fingerprint, execution.findings[1]!.fingerprint);
const rewordedScientific = { ...scientificFinding,
  diagnosticFact: "The same underlying gap described with different wording.",
  recommendation: "A differently worded recommendation.",
};
const rewordedExecution = assembleGrantSemanticReviewV6ExecutionForPersistence({
  documentId, actorId, checkerId: checkpointRecord.checkerId, snapshot, prepared,
  execution: {
    factMap, scientificFindings: [rewordedScientific], coverageReport,
    narrativeFindings: [narrativeFinding], providerCallCount: 3, completionTokenAllocation: 26_000,
    usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 100 },
    stages: execution.run.parsedOutput.stages as Array<{ stage: string; status: string; attemptCount: number; failureCode: string | null }>,
    resumedFrom: "none",
    imageCoverage: { mode: "text_only" },
  },
  startedAt: "2026-08-12T12:03:00.000Z", completedAt: "2026-08-12T12:04:00.000Z",
});
assert.equal(rewordedExecution.findings[0]!.fingerprint, execution.findings[0]!.fingerprint,
  "model wording must not change Scientific Finding identity");
assert.equal(rewordedExecution.findings[1]!.fingerprint, execution.findings[1]!.fingerprint,
  "model wording must not change Narrative Finding identity");
await repository.saveSemanticReviewV6Execution!(execution);
assert.equal(await repository.findSemanticReviewV6Checkpoint!(lookup), null, "atomic success must consume the checkpoint");
assert.equal((await repository.listFindings(documentId)).length, 2);

const migration = readFileSync("supabase/migrations/051_grant_semantic_review_v6_persistence.sql", "utf8");
assert.match(migration, /save_grant_semantic_review_v6_execution/);
assert.match(migration, /save_grant_diagnostic_execution/);
assert.match(migration, /diagnostic_base_revision_stale/);
assert.match(migration, /grant_semantic_review_v6_checkpoints/);
assert.match(migration, /grant_semantic_review_v6_finding_details/);
assert.match(migration, /status', 'consumed'/);

console.log("Grant Semantic Review V6 checkpoint and atomic persistence contracts passed.");
