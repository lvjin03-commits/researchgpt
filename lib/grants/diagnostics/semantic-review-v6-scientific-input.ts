import { z } from "zod";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  GrantFactMapV1Schema,
  GrantSemanticObjectTypeV1Schema,
  type GrantFactMapV1,
} from "./semantic-review-v6-contracts.ts";
import {
  GrantDiagnosticAtomicSectionSchema,
  GrantSemanticDiagnosticV3EvidenceInputSchema,
} from "./semantic-v3-input.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "./semantic-review-v6-input.ts";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const LocationRefSchema = z.string().regex(/^N[1-9]\d*$/);
const SemanticRefSchema = z.string().regex(/^S[1-9]\d*$/);

const PriorFindingReferenceSchema = z.object({
  findingFingerprint: z.string().trim().min(1).max(128),
  category: z.string().trim().min(1).max(80),
  status: z.enum(["open", "closed", "superseded"]),
  locationRef: LocationRefSchema,
}).strict();

export const GrantScientificReviewModelInputV1Schema = z.object({
  contractVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion),
  schemaVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.scientificFindingSchemaVersion),
  promptVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion),
  stage: z.literal("scientific_review"),
  locationScopeFingerprint: Sha256Schema,
  documentLanguage: z.enum(["zh", "en"]),
  documentTitle: z.string().trim().min(1),
  fundingCategory: z.string().trim().min(1).max(200),
  inputMode: z.enum(["full_document", "section_bundle", "focused_excerpt"]),
  sections: z.array(GrantDiagnosticAtomicSectionSchema).min(1),
  evidenceCards: z.array(GrantSemanticDiagnosticV3EvidenceInputSchema).max(8),
  priorFindings: z.array(PriorFindingReferenceSchema).max(100),
  expectedCoverageItemCount: z.number().int().min(1).max(256),
  factMapObjects: z.array(z.object({
    semanticObjectRef: SemanticRefSchema,
    objectType: GrantSemanticObjectTypeV1Schema,
    normalizedFacet: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
    sourceLocationRefs: z.array(LocationRefSchema).min(1).max(24),
  }).strict()).max(256),
}).strict();

export type GrantScientificReviewModelInputV1 = z.infer<typeof GrantScientificReviewModelInputV1Schema>;

export class GrantScientificReviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantScientificReviewInputError";
  }
}

/** Resolve mature Fact Map anchors back to the same execution-local N* aliases
 * used by the frozen text. No semantic or canonical identity is rebuilt. */
export function buildGrantScientificReviewModelInputV1(input: {
  prepared: GrantSemanticReviewV6PreparedInputV1;
  factMap: GrantFactMapV1;
}): GrantScientificReviewModelInputV1 {
  const factMap = GrantFactMapV1Schema.parse(input.factMap);
  if (factMap.sourceRevisionId !== input.prepared.sourceRevisionId) {
    throw new GrantScientificReviewInputError("Fact Map revision does not match the frozen review input.");
  }
  if (factMap.locationScopeFingerprint !== input.prepared.locationScopeFingerprint) {
    throw new GrantScientificReviewInputError("Fact Map location scope does not match the frozen review input.");
  }

  const factMapObjects = factMap.semanticObjects.map((semanticObject) => {
    const refs = semanticObject.anchors.map((anchor) => {
      if (anchor.sourceRevisionId !== input.prepared.sourceRevisionId) {
        throw new GrantScientificReviewInputError("Fact Map anchor crossed the frozen revision boundary.");
      }
      const locationRef = input.prepared.locationRefByNodeId.get(anchor.nodeId);
      const canonical = locationRef ? input.prepared.locationByRef.get(locationRef) : undefined;
      if (!locationRef || canonical?.sectionId !== anchor.sectionId) {
        throw new GrantScientificReviewInputError("Fact Map anchor is outside the frozen location scope.");
      }
      return locationRef;
    });
    const sourceLocationRefs = [...new Set(refs)];
    if (sourceLocationRefs.length === 0) {
      throw new GrantScientificReviewInputError("Every Fact Map object requires a frozen source location.");
    }
    return {
      semanticObjectRef: semanticObject.semanticObjectRef,
      objectType: semanticObject.objectType,
      normalizedFacet: semanticObject.normalizedFacet,
      sourceLocationRefs,
    };
  });

  return GrantScientificReviewModelInputV1Schema.parse({
    ...input.prepared.reviewBaseRequest,
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.scientificFindingSchemaVersion,
    stage: "scientific_review",
    expectedCoverageItemCount: factMapObjects.length,
    factMapObjects,
  });
}
