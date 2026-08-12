import { z } from "zod";
import {
  GrantSemanticDiagnosticCategoryV3Schema,
  GrantSemanticRelatedLocationRoleV3Schema,
} from "./semantic-v3-contracts.ts";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SemanticRefSchema = z.string().regex(/^S[1-9][0-9]*$/);
const FindingRefSchema = z.string().regex(/^F[1-9][0-9]*$/);
const NormalizedFacetSchema = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);
const BoundedTextSchema = z.string().trim().min(1).max(2400);

/**
 * Contract-only version reservation for the next diagnostic-quality upgrade.
 * These constants are not production selection and must not be imported by
 * runtime composition until the later rollout step is separately authorized.
 */
export const GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS = {
  canonicalDocumentSchemaVersion: "grant-canonical-v1",
  semanticObjectSchemaVersion: "grant-semantic-object-v1",
  factMapCoverageSchemaVersion: "grant-fact-map-coverage-v1",
  providerContractVersion: "grant-semantic-diagnostic-v6",
  providerSchemaVersion: "grant-semantic-diagnostic-v6",
  scientificFindingSchemaVersion: "grant-scientific-finding-v1",
  narrativeFindingSchemaVersion: "grant-narrative-finding-v1",
  promptVersion: "grant-semantic-review-v6",
  policyVersion: "grant-ai-policy-v5",
  checkerVersion: "6.0.0",
} as const;

export const GrantDiagnosticPhysicalNodeTypeV1Schema = z.enum([
  "heading",
  "paragraph",
  "list",
  "table",
  "figure",
  "citation",
  "formula",
]);

/**
 * Read-only diagnostic projection of an existing canonical Grant node. nodeId
 * is the existing Grant Document Repository identity; this contract does not
 * create a second canonical ID.
 */
export const GrantDiagnosticPhysicalNodeAnchorV1Schema = z.object({
  sourceRevisionId: UuidSchema,
  sectionId: UuidSchema,
  nodeId: UuidSchema,
  nodeType: GrantDiagnosticPhysicalNodeTypeV1Schema,
  order: z.number().int().min(0),
  contentHash: Sha256Schema,
}).strict();

export const GrantSemanticObjectTypeV1Schema = z.enum([
  "scientific_question",
  "innovation_claim",
  "research_objective",
  "research_content",
  "technical_route",
  "mechanism_claim",
  "expected_metric",
  "preliminary_evidence",
  "expected_contribution",
]);

export const GrantSemanticObjectAnchorRangeV1Schema = z.object({
  sourceRevisionId: UuidSchema,
  sectionId: UuidSchema,
  nodeId: UuidSchema,
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().positive(),
  anchorHash: Sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.endOffset <= value.startOffset) {
    context.addIssue({
      code: "custom",
      path: ["endOffset"],
      message: "A semantic anchor range must end after it starts.",
    });
  }
});

/**
 * A model-recognized semantic object is revision-bound diagnostic scaffolding.
 * semanticObjectRef is execution-local and cannot be used as canonical document
 * identity or as a durable continuity key.
 */
export const GrantSemanticObjectV1Schema = z.object({
  schemaVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.semanticObjectSchemaVersion),
  sourceRevisionId: UuidSchema,
  semanticObjectRef: SemanticRefSchema,
  objectType: GrantSemanticObjectTypeV1Schema,
  normalizedFacet: NormalizedFacetSchema,
  anchors: z.array(GrantSemanticObjectAnchorRangeV1Schema).min(1).max(24),
}).strict().superRefine((value, context) => {
  const seenAnchors = new Set<string>();
  value.anchors.forEach((anchor, index) => {
    if (anchor.sourceRevisionId !== value.sourceRevisionId) {
      context.addIssue({
        code: "custom",
        path: ["anchors", index, "sourceRevisionId"],
        message: "Semantic object and anchor revisions must match.",
      });
    }
    const key = `${anchor.nodeId}:${anchor.startOffset}:${anchor.endOffset}`;
    if (seenAnchors.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["anchors", index],
        message: "Semantic object anchors must be unique.",
      });
    }
    seenAnchors.add(key);
  });
});

export const GrantFactMapCoverageDispositionV1Schema = z.enum([
  "residual_gap_found",
  "verified_no_residual_gap",
  "unable_to_verify",
]);

export const GrantFactMapUnableToVerifyReasonV1Schema = z.enum([
  "insufficient_document_content",
  "evidence_not_authorized",
  "image_not_authorized",
  "unsupported_input",
  "ambiguous_semantic_boundary",
]);

/**
 * Strict provider boundary for Fact Map coverage. Provider references remain
 * simple strings because Structured Outputs cannot enforce application regexes;
 * the program-owned assembler validates every reference below.
 */
export const GrantFactMapCoverageProviderResultV1Schema = z.object({
  coverageItems: z.array(z.object({
    semanticObjectRef: z.string(),
    objectType: GrantSemanticObjectTypeV1Schema,
    disposition: GrantFactMapCoverageDispositionV1Schema,
    findingRefs: z.array(z.string()),
    unableToVerifyReason: GrantFactMapUnableToVerifyReasonV1Schema.nullable(),
  }).strict()),
}).strict();

export const GrantFactMapCoverageItemV1Schema = z.object({
  semanticObjectRef: SemanticRefSchema,
  objectType: GrantSemanticObjectTypeV1Schema,
  disposition: GrantFactMapCoverageDispositionV1Schema,
  findingRefs: z.array(FindingRefSchema).max(16),
  unableToVerifyReason: GrantFactMapUnableToVerifyReasonV1Schema.nullable(),
}).strict().superRefine((value, context) => {
  if (new Set(value.findingRefs).size !== value.findingRefs.length) {
    context.addIssue({
      code: "custom",
      path: ["findingRefs"],
      message: "A coverage item cannot bind the same Finding twice.",
    });
  }
  if (value.disposition === "residual_gap_found") {
    if (value.findingRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["findingRefs"],
        message: "A residual gap must bind at least one Finding.",
      });
    }
    if (value.unableToVerifyReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["unableToVerifyReason"],
        message: "A verified residual gap cannot claim that verification was unavailable.",
      });
    }
  }
  if (value.disposition === "verified_no_residual_gap") {
    if (value.findingRefs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["findingRefs"],
        message: "A verified no-gap object cannot publish a Finding.",
      });
    }
    if (value.unableToVerifyReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["unableToVerifyReason"],
        message: "A verified no-gap object cannot claim that verification was unavailable.",
      });
    }
  }
  if (value.disposition === "unable_to_verify") {
    if (value.findingRefs.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["findingRefs"],
        message: "An unverified object cannot publish a Finding.",
      });
    }
    if (value.unableToVerifyReason === null) {
      context.addIssue({
        code: "custom",
        path: ["unableToVerifyReason"],
        message: "An unverified object requires a bounded reason.",
      });
    }
  }
});

export const GrantFactMapCoverageReportV1Schema = z.object({
  schemaVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapCoverageSchemaVersion),
  sourceRevisionId: UuidSchema,
  coverageItems: z.array(GrantFactMapCoverageItemV1Schema).max(256),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  value.coverageItems.forEach((item, index) => {
    if (seen.has(item.semanticObjectRef)) {
      context.addIssue({
        code: "custom",
        path: ["coverageItems", index, "semanticObjectRef"],
        message: "Each semantic object must have exactly one coverage disposition.",
      });
    }
    seen.add(item.semanticObjectRef);
  });
});

export const GrantFactMapCoverageIssueCodeV1Schema = z.enum([
  "provider_output_invalid",
  "semantic_object_input_invalid",
  "semantic_object_duplicate",
  "source_revision_mismatch",
  "coverage_item_invalid",
  "coverage_item_duplicate",
  "coverage_item_missing",
  "coverage_item_unknown",
  "coverage_object_type_mismatch",
  "coverage_finding_unknown",
  "coverage_finding_orphan",
]);

export type GrantFactMapCoverageIssueV1 = {
  code: z.infer<typeof GrantFactMapCoverageIssueCodeV1Schema>;
  path: string;
};

export type AssembleGrantFactMapCoverageInputV1 = {
  sourceRevisionId: string;
  semanticObjects: readonly unknown[];
  providerResult: unknown;
  validFindingRefs: readonly string[];
};

export type AssembleGrantFactMapCoverageResultV1 =
  | { success: true; report: z.infer<typeof GrantFactMapCoverageReportV1Schema> }
  | { success: false; issues: GrantFactMapCoverageIssueV1[] };

/**
 * Program-owned completeness gate. It does not infer whether a scientific gap
 * exists; it verifies that every frozen semantic object was reviewed exactly
 * once and that every published Finding is bound to at least one reviewed
 * object. Free text never decides coverage completeness.
 */
export function assembleGrantFactMapCoverageV1(
  input: AssembleGrantFactMapCoverageInputV1,
): AssembleGrantFactMapCoverageResultV1 {
  const issues: GrantFactMapCoverageIssueV1[] = [];
  const provider = GrantFactMapCoverageProviderResultV1Schema.safeParse(input.providerResult);
  if (!provider.success) {
    return { success: false, issues: [{ code: "provider_output_invalid", path: "providerResult" }] };
  }

  const expectedObjects = new Map<string, z.infer<typeof GrantSemanticObjectV1Schema>>();
  input.semanticObjects.forEach((candidate, index) => {
    const parsed = GrantSemanticObjectV1Schema.safeParse(candidate);
    if (!parsed.success) {
      issues.push({ code: "semantic_object_input_invalid", path: `semanticObjects.${index}` });
      return;
    }
    if (parsed.data.sourceRevisionId !== input.sourceRevisionId) {
      issues.push({ code: "source_revision_mismatch", path: `semanticObjects.${index}.sourceRevisionId` });
    }
    if (expectedObjects.has(parsed.data.semanticObjectRef)) {
      issues.push({ code: "semantic_object_duplicate", path: `semanticObjects.${index}.semanticObjectRef` });
    }
    expectedObjects.set(parsed.data.semanticObjectRef, parsed.data);
  });

  const validFindingRefs = new Set<string>();
  input.validFindingRefs.forEach((findingRef, index) => {
    if (FindingRefSchema.safeParse(findingRef).success) validFindingRefs.add(findingRef);
    else issues.push({ code: "coverage_finding_unknown", path: `validFindingRefs.${index}` });
  });

  const seenObjects = new Set<string>();
  const usedFindingRefs = new Set<string>();
  const coverageItems: z.infer<typeof GrantFactMapCoverageItemV1Schema>[] = [];
  provider.data.coverageItems.forEach((candidate, index) => {
    const parsed = GrantFactMapCoverageItemV1Schema.safeParse(candidate);
    if (!parsed.success) {
      issues.push({ code: "coverage_item_invalid", path: `coverageItems.${index}` });
      return;
    }
    const item = parsed.data;
    if (seenObjects.has(item.semanticObjectRef)) {
      issues.push({ code: "coverage_item_duplicate", path: `coverageItems.${index}.semanticObjectRef` });
    }
    seenObjects.add(item.semanticObjectRef);
    const expected = expectedObjects.get(item.semanticObjectRef);
    if (!expected) {
      issues.push({ code: "coverage_item_unknown", path: `coverageItems.${index}.semanticObjectRef` });
    } else if (expected.objectType !== item.objectType) {
      issues.push({ code: "coverage_object_type_mismatch", path: `coverageItems.${index}.objectType` });
    }
    item.findingRefs.forEach((findingRef, findingIndex) => {
      if (!validFindingRefs.has(findingRef)) {
        issues.push({ code: "coverage_finding_unknown", path: `coverageItems.${index}.findingRefs.${findingIndex}` });
      }
      usedFindingRefs.add(findingRef);
    });
    coverageItems.push(item);
  });

  for (const semanticObjectRef of expectedObjects.keys()) {
    if (!seenObjects.has(semanticObjectRef)) {
      issues.push({ code: "coverage_item_missing", path: `semanticObjects.${semanticObjectRef}` });
    }
  }
  for (const findingRef of validFindingRefs) {
    if (!usedFindingRefs.has(findingRef)) {
      issues.push({ code: "coverage_finding_orphan", path: `findings.${findingRef}` });
    }
  }
  if (issues.length > 0) return { success: false, issues };

  const report = GrantFactMapCoverageReportV1Schema.safeParse({
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapCoverageSchemaVersion,
    sourceRevisionId: input.sourceRevisionId,
    coverageItems,
  });
  if (!report.success) {
    return { success: false, issues: [{ code: "coverage_item_invalid", path: "coverageReport" }] };
  }
  return { success: true, report: report.data };
}

/**
 * Cross-run calibration input. Execution-local semanticObjectRef values and
 * free model prose are intentionally impossible in this strict schema.
 */
export const GrantSemanticObjectContinuityIdentityV1Schema = z.object({
  objectType: GrantSemanticObjectTypeV1Schema,
  normalizedFacet: NormalizedFacetSchema,
  physicalAnchors: z.array(z.object({
    nodeId: UuidSchema,
    anchorHash: Sha256Schema,
  }).strict()).min(1).max(24),
}).strict();

export const GrantSemanticObjectContinuityMatchV1Schema = z.enum([
  "same",
  "likely_same",
  "ambiguous",
  "different",
]);

export const GrantScientificEvidenceTierV1Schema = z.enum([
  "description_only",
  "performance_improvement",
  "structural_evidence",
  "mechanistic_evidence",
  "causal_evidence",
]);

export const GrantScientificEvidenceBasisV1Schema = z.enum([
  "document_only",
  "authorized_evidence",
  "requires_external_verification",
]);

export const GrantFindingAssessmentV1Schema = z.object({
  scope: z.enum(["cross_section", "section", "paragraph", "sentence", "term_or_citation"]),
  confidence: z.number().min(0).max(1),
  actionability: z.enum(["directly_actionable", "requires_evidence", "requires_expert_judgment"]),
}).strict();

const ProviderFindingAssessmentV1Schema = z.object({
  scope: z.enum(["cross_section", "section", "paragraph", "sentence", "term_or_citation"]),
  confidence: z.number(),
  actionability: z.enum(["directly_actionable", "requires_evidence", "requires_expert_judgment"]),
}).strict();

const ProviderScientificExistingDesignV1Schema = z.object({
  locationRef: z.string(),
  summary: z.string(),
  evidenceTier: GrantScientificEvidenceTierV1Schema,
}).strict();

const ProviderFindingRelatedLocationV1Schema = z.object({
  locationRef: z.string(),
  role: GrantSemanticRelatedLocationRoleV3Schema,
}).strict();

/** Scientific review asks what the application already does before naming the
 * residual gap. It must not be reused for prose-flow or visual-style advice. */
export const GrantScientificFindingProviderResultV1Schema = z.object({
  findings: z.array(z.object({
    findingRef: z.string(),
    category: GrantSemanticDiagnosticCategoryV3Schema,
    semanticObjectRefs: z.array(z.string()),
    title: z.string(),
    diagnosticFact: z.string(),
    existingDesign: z.array(ProviderScientificExistingDesignV1Schema),
    residualGap: z.string(),
    reasonExistingDesignIsInsufficient: z.string(),
    recommendation: z.string(),
    possibleReviewerQuestion: z.string().nullable(),
    assessment: ProviderFindingAssessmentV1Schema,
    primaryLocationRef: z.string(),
    relatedLocations: z.array(ProviderFindingRelatedLocationV1Schema),
    evidenceBasis: GrantScientificEvidenceBasisV1Schema,
    usedEvidenceCardIds: z.array(z.string()),
  }).strict()),
}).strict();

const CanonicalLocationV1Schema = z.object({
  sectionId: UuidSchema,
  nodeId: UuidSchema,
}).strict();

export const GrantScientificFindingContentV1Schema = z.object({
  findingRef: FindingRefSchema,
  category: GrantSemanticDiagnosticCategoryV3Schema,
  semanticObjectRefs: z.array(SemanticRefSchema).min(1).max(24),
  title: z.string().trim().min(1).max(240),
  diagnosticFact: BoundedTextSchema,
  existingDesign: z.array(CanonicalLocationV1Schema.extend({
    summary: z.string().trim().min(1).max(1200),
    evidenceTier: GrantScientificEvidenceTierV1Schema,
  }).strict()).max(4),
  residualGap: BoundedTextSchema,
  reasonExistingDesignIsInsufficient: BoundedTextSchema,
  recommendation: BoundedTextSchema,
  possibleReviewerQuestion: z.string().trim().min(1).max(1600).nullable(),
  assessment: GrantFindingAssessmentV1Schema,
  primaryLocation: CanonicalLocationV1Schema,
  relatedLocations: z.array(CanonicalLocationV1Schema.extend({
    role: GrantSemanticRelatedLocationRoleV3Schema,
  }).strict()).max(12),
  evidenceBasis: GrantScientificEvidenceBasisV1Schema,
  usedEvidenceCardIds: z.array(UuidSchema).max(24),
}).strict().superRefine((value, context) => {
  if (new Set(value.semanticObjectRefs).size !== value.semanticObjectRefs.length) {
    context.addIssue({ code: "custom", path: ["semanticObjectRefs"], message: "Semantic object references must be unique." });
  }
  if (value.evidenceBasis === "authorized_evidence" && value.usedEvidenceCardIds.length === 0) {
    context.addIssue({ code: "custom", path: ["usedEvidenceCardIds"], message: "Authorized-evidence findings must name Evidence Cards." });
  }
  if (value.evidenceBasis === "document_only" && value.usedEvidenceCardIds.length > 0) {
    context.addIssue({ code: "custom", path: ["usedEvidenceCardIds"], message: "Document-only findings cannot claim Evidence Cards." });
  }
  const seenDesignLocations = new Set<string>();
  value.existingDesign.forEach((design, index) => {
    const key = `${design.sectionId}:${design.nodeId}`;
    if (seenDesignLocations.has(key)) {
      context.addIssue({ code: "custom", path: ["existingDesign", index], message: "Existing-design locations must be unique." });
    }
    seenDesignLocations.add(key);
  });
});

export const GrantNarrativeFindingCategoryV1Schema = z.enum([
  "narrative_flow",
  "emphasis_balance",
  "opening_persuasion",
  "abstract_independent_readability",
  "language_register",
  "visual_communication",
]);

export const GrantNarrativeAffectedScopeV1Schema = z.enum([
  "abstract",
  "opening",
  "section",
  "paragraph",
  "cross_section",
  "figure",
]);

export const GrantNarrativeFindingProviderResultV1Schema = z.object({
  findings: z.array(z.object({
    findingRef: z.string(),
    category: GrantNarrativeFindingCategoryV1Schema,
    title: z.string(),
    observedPresentation: z.string(),
    readerFriction: z.string(),
    suggestedOrganization: z.string(),
    affectedScope: GrantNarrativeAffectedScopeV1Schema,
    assessment: ProviderFindingAssessmentV1Schema,
    primaryLocationRef: z.string(),
    relatedLocations: z.array(ProviderFindingRelatedLocationV1Schema),
    usedImageRefs: z.array(z.string()),
  }).strict()),
}).strict();

export const GrantNarrativeFindingContentV1Schema = z.object({
  findingRef: FindingRefSchema,
  category: GrantNarrativeFindingCategoryV1Schema,
  title: z.string().trim().min(1).max(240),
  observedPresentation: BoundedTextSchema,
  readerFriction: BoundedTextSchema,
  suggestedOrganization: BoundedTextSchema,
  affectedScope: GrantNarrativeAffectedScopeV1Schema,
  assessment: GrantFindingAssessmentV1Schema,
  primaryLocation: CanonicalLocationV1Schema,
  relatedLocations: z.array(CanonicalLocationV1Schema.extend({
    role: GrantSemanticRelatedLocationRoleV3Schema,
  }).strict()).max(12),
  usedFigureAssetIds: z.array(UuidSchema).max(12),
}).strict().superRefine((value, context) => {
  if (value.category === "visual_communication" && value.usedFigureAssetIds.length === 0) {
    context.addIssue({ code: "custom", path: ["usedFigureAssetIds"], message: "Visual findings require an authorized figure asset." });
  }
  if (value.category !== "visual_communication" && value.usedFigureAssetIds.length > 0) {
    context.addIssue({ code: "custom", path: ["usedFigureAssetIds"], message: "Only visual findings may claim figure assets." });
  }
});

export const GrantSemanticReviewFindingSetV1Schema = z.object({
  scientificFindings: z.array(GrantScientificFindingContentV1Schema).max(16),
  narrativeFindings: z.array(GrantNarrativeFindingContentV1Schema).max(16),
}).strict().superRefine((value, context) => {
  const seen = new Set<string>();
  [...value.scientificFindings, ...value.narrativeFindings].forEach((finding, index) => {
    if (seen.has(finding.findingRef)) {
      context.addIssue({ code: "custom", path: ["findings", index, "findingRef"], message: "Finding references must be unique across both axes." });
    }
    seen.add(finding.findingRef);
  });
});

/** Program-owned calibration result. Similarity scores are evidence for the
 * match state; no threshold or match decision is delegated to the model. */
export const GrantSemanticObjectContinuityAssessmentV1Schema = z.object({
  previousSourceRevisionId: UuidSchema,
  currentSourceRevisionId: UuidSchema,
  previousSemanticObjectRef: SemanticRefSchema,
  currentSemanticObjectRef: SemanticRefSchema,
  match: GrantSemanticObjectContinuityMatchV1Schema,
  physicalNodeOverlap: z.number().min(0).max(1),
  anchorTextSimilarity: z.number().min(0).max(1),
}).strict().superRefine((value, context) => {
  if (value.previousSourceRevisionId === value.currentSourceRevisionId) {
    context.addIssue({
      code: "custom",
      path: ["currentSourceRevisionId"],
      message: "Cross-run semantic calibration requires distinct source revisions.",
    });
  }
});

export type GrantDiagnosticPhysicalNodeAnchorV1 = z.infer<typeof GrantDiagnosticPhysicalNodeAnchorV1Schema>;
export type GrantSemanticObjectTypeV1 = z.infer<typeof GrantSemanticObjectTypeV1Schema>;
export type GrantSemanticObjectAnchorRangeV1 = z.infer<typeof GrantSemanticObjectAnchorRangeV1Schema>;
export type GrantSemanticObjectV1 = z.infer<typeof GrantSemanticObjectV1Schema>;
export type GrantFactMapCoverageProviderResultV1 = z.infer<typeof GrantFactMapCoverageProviderResultV1Schema>;
export type GrantFactMapCoverageItemV1 = z.infer<typeof GrantFactMapCoverageItemV1Schema>;
export type GrantFactMapCoverageReportV1 = z.infer<typeof GrantFactMapCoverageReportV1Schema>;
export type GrantScientificFindingContentV1 = z.infer<typeof GrantScientificFindingContentV1Schema>;
export type GrantNarrativeFindingContentV1 = z.infer<typeof GrantNarrativeFindingContentV1Schema>;
export type GrantSemanticReviewFindingSetV1 = z.infer<typeof GrantSemanticReviewFindingSetV1Schema>;
export type GrantSemanticObjectContinuityIdentityV1 = z.infer<typeof GrantSemanticObjectContinuityIdentityV1Schema>;
export type GrantSemanticObjectContinuityAssessmentV1 = z.infer<typeof GrantSemanticObjectContinuityAssessmentV1Schema>;
