import assert from "node:assert/strict";
import { assembleGrantSemanticDiagnosticsV3 } from "../lib/grants/diagnostics/semantic-v3-assembler.ts";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import type { GrantSemanticDiagnosticResultV3 } from "../lib/grants/diagnostics/semantic-v3-contracts.ts";
import {
  GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION,
  GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
} from "../lib/grants/ports/grant-diagnostic-model.ts";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const section1 = id("11"), section2 = id("12"), node1 = id("21"), node2 = id("22"), node3 = id("23");
const evidenceId = id("31");
const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "Test",
  sections: [
    { sectionId: section2, semanticRole: "route", title: "Route", order: 1, nodeIds: [node3] },
    { sectionId: section1, semanticRole: "basis", title: "Basis", order: 0, nodeIds: [node1, node2] },
  ],
  nodes: [
    { nodeId: node3, sectionId: section2, order: 0, nodeType: "paragraph", content: { text: "Route" } },
    { nodeId: node2, sectionId: section1, order: 1, nodeType: "paragraph", content: { text: "Second" } },
    { nodeId: node1, sectionId: section1, order: 0, nodeType: "paragraph", content: { text: "First" } },
  ],
};
const base: GrantSemanticDiagnosticResultV3["findings"][number] = {
  category: "argument_chain_gap",
  title: "Missing transition",
  diagnosticFact: "The background jumps directly to the method.",
  reason: "The inference is absent.",
  recommendation: "Add the inference.",
  possibleConsequence: null,
  assessment: { scope: "paragraph", confidence: 0.8, actionability: "directly_actionable" },
  primaryLocation: { sectionId: section1, nodeId: node2 },
  relatedLocations: [
    { sectionId: section2, nodeId: node3, role: "downstream_dependency", quote: "Route" },
    { sectionId: section1, nodeId: node1, role: "upstream_dependency", quote: "Background" },
  ],
  usedEvidenceCardIds: [evidenceId],
};
const metadata = {
  runId: id("1"), documentId: id("2"), sourceRevisionId: id("3"),
  checkerId: "grant-semantic-review", checkerVersion: "4.0.0",
  contractVersion: GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION, schemaVersion: "grant-semantic-finding-v3",
  policyVersion: GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
};
const findingIds = [id("41"), id("42")];
let nextId = 0;
const assemble = (findings: GrantSemanticDiagnosticResultV3["findings"]) => assembleGrantSemanticDiagnosticsV3({
  metadata, snapshot, result: { findings },
  referenceScope: {
    sectionIdByNodeId: new Map(snapshot.nodes.map((node) => [node.nodeId, node.sectionId])),
    allowedEvidenceCardIds: new Set([evidenceId]),
  },
  createId: () => findingIds[nextId++]!,
  now: () => "2026-08-09T12:00:00.000Z",
});

const later = { ...base, category: "research_design_gap" as const, title: "Late", diagnosticFact: "A control is absent.", primaryLocation: { sectionId: section2, nodeId: node3 }, relatedLocations: [] };
const first = assemble([later, base]);
assert.deepEqual(first.map((finding) => finding.primaryLocation.nodeId), [node2, node3]);
assert.deepEqual(first[0]?.relatedLocations.map((location) => location.nodeId), [node1, node3]);
assert.deepEqual(first.map((finding) => finding.displayOrder), [0, 1]);

nextId = 0;
const presentationChanged = assemble([{
  ...base, title: "Other title", reason: "Other reason", recommendation: "Other advice",
  possibleConsequence: "Other consequence",
  assessment: { scope: "paragraph", confidence: 0.2, actionability: "requires_expert_judgment" },
  relatedLocations: [...base.relatedLocations].reverse(),
}]);
assert.equal(presentationChanged[0]?.fingerprint, first[0]?.fingerprint);

nextId = 0;
const factChanged = assemble([{ ...base, diagnosticFact: "A materially different fact." }]);
assert.notEqual(factChanged[0]?.fingerprint, first[0]?.fingerprint);

nextId = 0;
assert.equal(assemble([base, { ...base, recommendation: "Alternative advice" }]).length, 1);
console.log("Grant semantic diagnostic V3 assembler verification passed.");
