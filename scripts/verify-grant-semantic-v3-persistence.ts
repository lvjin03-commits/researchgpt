import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InMemoryGrantDiagnosticRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-diagnostic-repository.ts";
import { assembleGrantSemanticDiagnosticsV3 } from "../lib/grants/diagnostics/semantic-v3-assembler.ts";
import { GrantDiagnosticRunSchema, GrantFindingSchema } from "../lib/grants/diagnostics/contracts.ts";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import {
  GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION,
  GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
} from "../lib/grants/ports/grant-diagnostic-model.ts";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const documentId = id("1"), revisionId = id("2"), sectionId = id("3"), nodeId = id("4"), runId = id("5");
const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "Application",
  sections: [{ sectionId, semanticRole: "basis", title: "Basis", order: 0, nodeIds: [nodeId] }],
  nodes: [{ nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "A claim without its inference." } }],
};
const run = GrantDiagnosticRunSchema.parse({
  runId, documentId, sourceRevisionId: revisionId,
  checkerId: "grant-semantic-review", checkerVersion: "4.0.0",
  contractVersion: GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION, inputMode: "full_document",
  inputNodeIds: [nodeId], inputHash: "a".repeat(64), status: "succeeded",
  parsedOutput: { findingCount: 1 }, createdBy: id("6"),
  startedAt: "2026-08-09T12:00:00.000Z", completedAt: "2026-08-09T12:00:01.000Z",
});
const [v3Finding] = assembleGrantSemanticDiagnosticsV3({
  metadata: {
    runId, documentId, sourceRevisionId: revisionId,
    checkerId: run.checkerId, checkerVersion: run.checkerVersion,
    contractVersion: run.contractVersion, schemaVersion: "grant-semantic-finding-v3",
    policyVersion: GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
  },
  snapshot,
  result: { findings: [{
    category: "argument_chain_gap", title: "Missing inference",
    diagnosticFact: "The application moves from a general limitation directly to the method.",
    reason: "The connecting inference is not stated.", recommendation: "State the connecting inference.",
    possibleConsequence: null,
    assessment: { scope: "paragraph", confidence: 0.8, actionability: "directly_actionable" },
    primaryLocation: { sectionId, nodeId }, relatedLocations: [], usedEvidenceCardIds: [],
  }] },
  referenceScope: { sectionIdByNodeId: new Map([[nodeId, sectionId]]), allowedEvidenceCardIds: new Set() },
  createId: () => id("7"), now: () => "2026-08-09T12:00:01.000Z",
});
assert.ok(v3Finding);

const repository = new InMemoryGrantDiagnosticRepository();
const v2Finding = GrantFindingSchema.parse({
  findingId: id("8"), runId: id("9"), documentId, sourceRevisionId: revisionId,
  checkerId: "structural", checkerVersion: "1.0.0", fingerprint: "b".repeat(64),
  code: "thin_section", message: "Section is thin.", recommendation: "Add specific content.",
  assessment: { scope: "section", confidence: 1, actionability: "directly_actionable" },
  sourceAnchor: v3Finding.sourceAnchor, lifecycleStatus: "open", createdAt: "2026-08-09T11:00:00.000Z",
});
const v2Run = GrantDiagnosticRunSchema.parse({ ...run, runId: v2Finding.runId, checkerId: "structural", checkerVersion: "1.0.0", contractVersion: "grant-diagnostic-v2" });
await repository.saveExecution({ runs: [v2Run], findings: [v2Finding], conflicts: [] });
await repository.saveSemanticV3Execution({ run, findings: [v3Finding] });

const compatible = await repository.listFindings(documentId);
assert.equal(compatible.length, 2);
assert.equal(compatible.find((finding) => finding.findingId === v3Finding.findingId)?.message, v3Finding.diagnosticFact);

const normalized = await repository.listNormalizedFindings(documentId);
assert.equal(normalized.length, 2);
assert.equal(normalized.find((finding) => finding.findingId === v2Finding.findingId)?.schemaVersion, "grant-finding-v2");
const normalizedV3 = normalized.find((finding) => finding.findingId === v3Finding.findingId);
assert.equal(normalizedV3?.schemaVersion, "grant-semantic-finding-v3");
assert.equal(normalizedV3?.reason, v3Finding.reason);
assert.deepEqual(normalizedV3?.relatedLocations, []);

const migration = readFileSync("supabase/migrations/046_grant_semantic_atomic_location_refs.sql", "utf8");
assert.match(migration, /PERFORM public\.save_grant_diagnostic_execution/);
assert.match(migration, /grant-semantic-diagnostic-v3/);
assert.match(migration, /grant-semantic-diagnostic-v4/);
console.log("Grant semantic diagnostic V3 persistence and normalized projection contracts passed.");
