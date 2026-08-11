import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  GrantDiagnosticPhysicalNodeAnchorV1Schema,
  GrantSemanticObjectAnchorRangeV1Schema,
  GrantSemanticObjectContinuityAssessmentV1Schema,
  GrantSemanticObjectContinuityIdentityV1Schema,
  GrantSemanticObjectV1Schema,
} from "../lib/grants/diagnostics/semantic-review-v6-contracts.ts";
import { GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS } from "../lib/grants/diagnostics/hierarchical-semantic-contracts.ts";

const revisionId = randomUUID();
const nextRevisionId = randomUUID();
const sectionId = randomUUID();
const nodeId = randomUUID();
const contentHash = "a".repeat(64);
const anchorHash = "b".repeat(64);

assert.doesNotThrow(() => GrantDiagnosticPhysicalNodeAnchorV1Schema.parse({
  sourceRevisionId: revisionId,
  sectionId,
  nodeId,
  nodeType: "paragraph",
  order: 2,
  contentHash,
}));

const anchor = {
  sourceRevisionId: revisionId,
  sectionId,
  nodeId,
  startOffset: 4,
  endOffset: 28,
  anchorHash,
};
assert.doesNotThrow(() => GrantSemanticObjectAnchorRangeV1Schema.parse(anchor));
assert.throws(() => GrantSemanticObjectAnchorRangeV1Schema.parse({ ...anchor, endOffset: 4 }));

const semanticObject = {
  schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.semanticObjectSchemaVersion,
  sourceRevisionId: revisionId,
  semanticObjectRef: "S1",
  objectType: "innovation_claim",
  normalizedFacet: "ion_bridge_mechanism",
  anchors: [anchor],
};
assert.doesNotThrow(() => GrantSemanticObjectV1Schema.parse(semanticObject));
assert.throws(() => GrantSemanticObjectV1Schema.parse({
  ...semanticObject,
  canonicalNodeId: randomUUID(),
}), "a semantic object must not masquerade as a canonical document node");
assert.throws(() => GrantSemanticObjectV1Schema.parse({
  ...semanticObject,
  anchors: [{ ...anchor, sourceRevisionId: nextRevisionId }],
}), "semantic objects cannot cross a frozen revision boundary");
assert.throws(() => GrantSemanticObjectV1Schema.parse({
  ...semanticObject,
  anchors: [anchor, anchor],
}), "duplicate semantic anchors must be rejected");

const continuityIdentity = {
  objectType: "innovation_claim",
  normalizedFacet: "ion_bridge_mechanism",
  physicalAnchors: [{ nodeId, anchorHash }],
};
assert.doesNotThrow(() => GrantSemanticObjectContinuityIdentityV1Schema.parse(continuityIdentity));
assert.throws(() => GrantSemanticObjectContinuityIdentityV1Schema.parse({
  ...continuityIdentity,
  semanticObjectRef: "S1",
}), "execution-local semantic references cannot become continuity identity");
assert.throws(() => GrantSemanticObjectContinuityIdentityV1Schema.parse({
  ...continuityIdentity,
  modelSummary: "Free model prose must not become continuity identity.",
}));

assert.doesNotThrow(() => GrantSemanticObjectContinuityAssessmentV1Schema.parse({
  previousSourceRevisionId: revisionId,
  currentSourceRevisionId: nextRevisionId,
  previousSemanticObjectRef: "S1",
  currentSemanticObjectRef: "S3",
  match: "ambiguous",
  physicalNodeOverlap: 0.5,
  anchorTextSimilarity: 0.74,
}));

assert.equal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerSchemaVersion);
assert.equal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion,
  "grant-semantic-diagnostic-v5", "contract-only V6 work must not advance active V5 runtime versions");
assert.equal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.checkerVersion,
  "5.1.0", "contract-only V6 work must not change the selected checker");

console.log("Grant Semantic Review V6 dual-node target contracts passed.");
