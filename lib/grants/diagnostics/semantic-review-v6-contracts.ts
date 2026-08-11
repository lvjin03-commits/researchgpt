import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const SemanticRefSchema = z.string().regex(/^S[1-9][0-9]*$/);
const NormalizedFacetSchema = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);

/**
 * Contract-only version reservation for the next diagnostic-quality upgrade.
 * These constants are not production selection and must not be imported by
 * runtime composition until the later rollout step is separately authorized.
 */
export const GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS = {
  canonicalDocumentSchemaVersion: "grant-canonical-v1",
  semanticObjectSchemaVersion: "grant-semantic-object-v1",
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
export type GrantSemanticObjectContinuityIdentityV1 = z.infer<typeof GrantSemanticObjectContinuityIdentityV1Schema>;
export type GrantSemanticObjectContinuityAssessmentV1 = z.infer<typeof GrantSemanticObjectContinuityAssessmentV1Schema>;
