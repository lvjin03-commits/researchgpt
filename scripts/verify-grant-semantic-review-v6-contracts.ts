import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { zodResponseFormat } from "openai/helpers/zod";
import "./verify-grant-semantic-review-v6-input.ts";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  assembleGrantFactMapCoverageV1,
  GrantDiagnosticPhysicalNodeAnchorV1Schema,
  GrantFactMapProviderResultV1Schema,
  GrantFactMapCoverageProviderResultV1Schema,
  GrantNarrativeFindingContentV1Schema,
  GrantNarrativeFindingProviderResultV1Schema,
  GrantScientificFindingContentV1Schema,
  GrantScientificFindingProviderResultV1Schema,
  GrantSemanticReviewFindingSetV1Schema,
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

const forbiddenProviderKeywords = new Set([
  "default", "format", "pattern", "minLength", "maxLength", "minimum",
  "maximum", "minItems", "maxItems",
]);

function assertStrictProviderSchema(value: unknown, path = "$schema"): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const keyword of forbiddenProviderKeywords) {
    assert.equal(keyword in record, false, `${path} must not use ${keyword}`);
  }
  if (record.type === "object") {
    assert.equal(record.additionalProperties, false, `${path} must reject additional properties`);
    const propertyNames = Object.keys((record.properties ?? {}) as Record<string, unknown>);
    assert.deepEqual(record.required, propertyNames, `${path} must require every property`);
  }
  for (const [key, child] of Object.entries(record)) assertStrictProviderSchema(child, `${path}.${key}`);
}

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

const secondSemanticObject = {
  ...semanticObject,
  semanticObjectRef: "S2",
  objectType: "scientific_question" as const,
  normalizedFacet: "interface_reaction_control",
};
const thirdSemanticObject = {
  ...semanticObject,
  semanticObjectRef: "S3",
  objectType: "preliminary_evidence" as const,
  normalizedFacet: "preliminary_mechanism_evidence",
};
const providerCoverage = {
  coverageItems: [
    {
      semanticObjectRef: "S1",
      objectType: "innovation_claim",
      disposition: "residual_gap_found",
      findingRefs: ["F1"],
      unableToVerifyReason: null,
    },
    {
      semanticObjectRef: "S2",
      objectType: "scientific_question",
      disposition: "verified_no_residual_gap",
      findingRefs: [],
      unableToVerifyReason: null,
    },
    {
      semanticObjectRef: "S3",
      objectType: "preliminary_evidence",
      disposition: "unable_to_verify",
      findingRefs: [],
      unableToVerifyReason: "evidence_not_authorized",
    },
  ],
};

for (const [schema, name] of [
  [GrantFactMapProviderResultV1Schema, "grant_fact_map_v1"],
  [GrantFactMapCoverageProviderResultV1Schema, "grant_fact_map_coverage_v1"],
  [GrantScientificFindingProviderResultV1Schema, "grant_scientific_finding_v1"],
  [GrantNarrativeFindingProviderResultV1Schema, "grant_narrative_finding_v1"],
] as const) {
  const responseFormat = zodResponseFormat(schema, name);
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(responseFormat.json_schema.strict, true);
  assertStrictProviderSchema(responseFormat.json_schema.schema);
}

const assembledCoverage = assembleGrantFactMapCoverageV1({
  sourceRevisionId: revisionId,
  semanticObjects: [semanticObject, secondSemanticObject, thirdSemanticObject],
  providerResult: providerCoverage,
  validFindingRefs: ["F1"],
});
assert.equal(assembledCoverage.success, true);
if (assembledCoverage.success) {
  assert.equal(assembledCoverage.report.coverageItems.length, 3);
  assert.equal(assembledCoverage.report.schemaVersion, "grant-fact-map-coverage-v1");
}

const missingCoverage = assembleGrantFactMapCoverageV1({
  sourceRevisionId: revisionId,
  semanticObjects: [semanticObject, secondSemanticObject, thirdSemanticObject],
  providerResult: { coverageItems: providerCoverage.coverageItems.slice(0, 2) },
  validFindingRefs: ["F1"],
});
assert.equal(missingCoverage.success, false);
if (!missingCoverage.success) {
  assert(missingCoverage.issues.some((issue) => issue.code === "coverage_item_missing"));
}

const duplicateCoverage = assembleGrantFactMapCoverageV1({
  sourceRevisionId: revisionId,
  semanticObjects: [semanticObject, secondSemanticObject, thirdSemanticObject],
  providerResult: {
    coverageItems: [...providerCoverage.coverageItems, providerCoverage.coverageItems[0]],
  },
  validFindingRefs: ["F1"],
});
assert.equal(duplicateCoverage.success, false);
if (!duplicateCoverage.success) {
  assert(duplicateCoverage.issues.some((issue) => issue.code === "coverage_item_duplicate"));
}

const noGapWithFinding = assembleGrantFactMapCoverageV1({
  sourceRevisionId: revisionId,
  semanticObjects: [semanticObject],
  providerResult: {
    coverageItems: [{
      semanticObjectRef: "S1",
      objectType: "innovation_claim",
      disposition: "verified_no_residual_gap",
      findingRefs: ["F1"],
      unableToVerifyReason: null,
    }],
  },
  validFindingRefs: ["F1"],
});
assert.equal(noGapWithFinding.success, false);
if (!noGapWithFinding.success) {
  assert(noGapWithFinding.issues.some((issue) => issue.code === "coverage_item_invalid"));
}

const residualGapWithoutFinding = assembleGrantFactMapCoverageV1({
  sourceRevisionId: revisionId,
  semanticObjects: [semanticObject],
  providerResult: {
    coverageItems: [{
      semanticObjectRef: "S1",
      objectType: "innovation_claim",
      disposition: "residual_gap_found",
      findingRefs: [],
      unableToVerifyReason: null,
    }],
  },
  validFindingRefs: [],
});
assert.equal(residualGapWithoutFinding.success, false);
if (!residualGapWithoutFinding.success) {
  assert(residualGapWithoutFinding.issues.some((issue) => issue.code === "coverage_item_invalid"));
}

const unableWithoutReason = assembleGrantFactMapCoverageV1({
  sourceRevisionId: revisionId,
  semanticObjects: [semanticObject],
  providerResult: {
    coverageItems: [{
      semanticObjectRef: "S1",
      objectType: "innovation_claim",
      disposition: "unable_to_verify",
      findingRefs: [],
      unableToVerifyReason: null,
    }],
  },
  validFindingRefs: [],
});
assert.equal(unableWithoutReason.success, false);
if (!unableWithoutReason.success) {
  assert(unableWithoutReason.issues.some((issue) => issue.code === "coverage_item_invalid"));
}

const orphanFinding = assembleGrantFactMapCoverageV1({
  sourceRevisionId: revisionId,
  semanticObjects: [semanticObject, secondSemanticObject, thirdSemanticObject],
  providerResult: providerCoverage,
  validFindingRefs: ["F1", "F2"],
});
assert.equal(orphanFinding.success, false);
if (!orphanFinding.success) {
  assert(orphanFinding.issues.some((issue) => issue.code === "coverage_finding_orphan"));
}

const wrongObjectType = assembleGrantFactMapCoverageV1({
  sourceRevisionId: revisionId,
  semanticObjects: [semanticObject, secondSemanticObject, thirdSemanticObject],
  providerResult: {
    coverageItems: providerCoverage.coverageItems.map((item) => item.semanticObjectRef === "S2"
      ? { ...item, objectType: "innovation_claim" }
      : item),
  },
  validFindingRefs: ["F1"],
});
assert.equal(wrongObjectType.success, false);
if (!wrongObjectType.success) {
  assert(wrongObjectType.issues.some((issue) => issue.code === "coverage_object_type_mismatch"));
}

const evidenceCardId = randomUUID();
const figureAssetId = randomUUID();
const scientificProviderFinding = {
  findingRef: "F1",
  category: "evidence_support_gap" as const,
  semanticObjectRefs: ["S1"],
  title: "The claimed mechanism exceeds the evidence shown",
  diagnosticFact: "The application presents cycling performance as support for a molecular mechanism.",
  existingDesign: [{
    locationRef: "N1",
    summary: "Long-cycle performance is reported under one condition.",
    evidenceTier: "performance_improvement" as const,
  }],
  residualGap: "The design does not directly observe the claimed molecular transition.",
  reasonExistingDesignIsInsufficient: "Performance evidence cannot by itself establish a mechanism or causal pathway.",
  recommendation: "Add a direct mechanism-sensitive observation and a falsifiable comparison.",
  possibleReviewerQuestion: null,
  assessment: { scope: "cross_section" as const, confidence: 0.91, actionability: "requires_evidence" as const },
  primaryLocationRef: "N1",
  relatedLocations: [{ locationRef: "N2", role: "supporting_location" as const }],
  evidenceBasis: "authorized_evidence" as const,
  usedEvidenceCardIds: [evidenceCardId],
};
assert.doesNotThrow(() => GrantScientificFindingProviderResultV1Schema.parse({ findings: [scientificProviderFinding] }));
assert.throws(() => GrantScientificFindingProviderResultV1Schema.parse({
  findings: [{ ...scientificProviderFinding, severity: "high" }],
}), "scientific findings must not accept severity");
assert.throws(() => GrantScientificFindingProviderResultV1Schema.parse({
  findings: [{ ...scientificProviderFinding, readerFriction: "This belongs to narrative review." }],
}), "scientific findings must not absorb narrative fields");

const scientificFinding = {
  ...scientificProviderFinding,
  primaryLocation: { sectionId, nodeId },
  relatedLocations: [{ sectionId, nodeId: randomUUID(), role: "supporting_location" as const }],
  existingDesign: [{
    sectionId,
    nodeId,
    summary: scientificProviderFinding.existingDesign[0].summary,
    evidenceTier: "performance_improvement" as const,
  }],
};
const { primaryLocationRef: _scientificPrimaryRef, ...scientificWithoutPrimaryRef } = scientificFinding;
assert.doesNotThrow(() => GrantScientificFindingContentV1Schema.parse(scientificWithoutPrimaryRef));
assert.throws(() => GrantScientificFindingContentV1Schema.parse({
  ...scientificWithoutPrimaryRef,
  evidenceBasis: "authorized_evidence",
  usedEvidenceCardIds: [],
}));
assert.throws(() => GrantScientificFindingContentV1Schema.parse({
  ...scientificWithoutPrimaryRef,
  evidenceBasis: "document_only",
  usedEvidenceCardIds: [evidenceCardId],
}));
assert.throws(() => GrantScientificFindingContentV1Schema.parse({
  ...scientificWithoutPrimaryRef,
  existingDesign: [scientificWithoutPrimaryRef.existingDesign[0], scientificWithoutPrimaryRef.existingDesign[0]],
}));

const narrativeProviderFinding = {
  findingRef: "F2",
  category: "narrative_flow" as const,
  title: "The central hypothesis appears after implementation detail",
  observedPresentation: "Two implementation paragraphs precede the first explicit hypothesis statement.",
  readerFriction: "The reader must infer why the listed methods answer the proposed question.",
  suggestedOrganization: "State the hypothesis before the implementation sequence, then map each method to it.",
  affectedScope: "section" as const,
  assessment: { scope: "section" as const, confidence: 0.88, actionability: "directly_actionable" as const },
  primaryLocationRef: "N3",
  relatedLocations: [{ locationRef: "N4", role: "upstream_dependency" as const }],
  usedImageRefs: [],
};
assert.doesNotThrow(() => GrantNarrativeFindingProviderResultV1Schema.parse({ findings: [narrativeProviderFinding] }));
assert.throws(() => GrantNarrativeFindingProviderResultV1Schema.parse({
  findings: [{ ...narrativeProviderFinding, residualGap: "This belongs to scientific review." }],
}), "narrative findings must not absorb scientific residual-gap fields");
assert.throws(() => GrantNarrativeFindingProviderResultV1Schema.parse({
  findings: [{ ...narrativeProviderFinding, priority: "high" }],
}), "narrative findings must not accept priority");

const narrativeFinding = {
  findingRef: "F2",
  category: "narrative_flow" as const,
  title: narrativeProviderFinding.title,
  observedPresentation: narrativeProviderFinding.observedPresentation,
  readerFriction: narrativeProviderFinding.readerFriction,
  suggestedOrganization: narrativeProviderFinding.suggestedOrganization,
  affectedScope: "section" as const,
  assessment: narrativeProviderFinding.assessment,
  primaryLocation: { sectionId, nodeId },
  relatedLocations: [{ sectionId, nodeId: randomUUID(), role: "upstream_dependency" as const }],
  usedFigureAssetIds: [],
};
assert.doesNotThrow(() => GrantNarrativeFindingContentV1Schema.parse(narrativeFinding));
const visualFinding = {
  ...narrativeFinding,
  findingRef: "F3",
  category: "visual_communication" as const,
  affectedScope: "figure" as const,
  usedFigureAssetIds: [figureAssetId],
};
assert.doesNotThrow(() => GrantNarrativeFindingContentV1Schema.parse(visualFinding));
assert.throws(() => GrantNarrativeFindingContentV1Schema.parse({ ...visualFinding, usedFigureAssetIds: [] }));
assert.throws(() => GrantNarrativeFindingContentV1Schema.parse({
  ...narrativeFinding,
  usedFigureAssetIds: [figureAssetId],
}));

assert.doesNotThrow(() => GrantSemanticReviewFindingSetV1Schema.parse({
  scientificFindings: [scientificWithoutPrimaryRef],
  narrativeFindings: [narrativeFinding],
}));
assert.throws(() => GrantSemanticReviewFindingSetV1Schema.parse({
  scientificFindings: [scientificWithoutPrimaryRef],
  narrativeFindings: [{ ...narrativeFinding, findingRef: "F1" }],
}), "Finding references must be unique across scientific and narrative axes");

assert.equal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerSchemaVersion);
assert.equal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapCoverageSchemaVersion,
  "grant-fact-map-coverage-v1");
assert.equal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion,
  "grant-semantic-diagnostic-v5", "contract-only V6 work must not advance active V5 runtime versions");
assert.equal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.checkerVersion,
  "5.1.0", "contract-only V6 work must not change the selected checker");

console.log("Grant Semantic Review V6 dual-node target contracts passed.");
