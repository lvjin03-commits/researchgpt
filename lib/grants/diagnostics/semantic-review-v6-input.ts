import { createHash } from "node:crypto";
import { z } from "zod";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
} from "./semantic-review-v6-contracts.ts";
import {
  GrantDiagnosticAtomicSectionSchema,
  GrantSemanticDiagnosticV3EvidenceInputSchema,
} from "./semantic-v3-input.ts";
import type { GrantHierarchicalDiagnosticPreparedInputV1 } from "./hierarchical-semantic-input.ts";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const LocationRefSchema = z.string().regex(/^N[1-9]\d*$/);

const PriorFindingReferenceSchema = z.object({
  findingFingerprint: z.string().trim().min(1).max(128),
  category: z.string().trim().min(1).max(80),
  status: z.enum(["open", "closed", "superseded"]),
  locationRef: LocationRefSchema,
}).strict();

const SemanticReviewV6InputHeaderSchema = z.object({
  contractVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion),
  schemaVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapSchemaVersion),
  promptVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion),
  locationScopeFingerprint: Sha256Schema,
  documentLanguage: z.enum(["zh", "en"]),
  documentTitle: z.string().trim().min(1),
  fundingCategory: z.string().trim().min(1).max(200),
  inputMode: z.enum(["full_document", "section_bundle", "focused_excerpt"]),
}).strict();

export const GrantFactMapModelInputV1Schema = SemanticReviewV6InputHeaderSchema.extend({
  stage: z.literal("fact_mapping"),
  sections: z.array(GrantDiagnosticAtomicSectionSchema).min(1),
}).strict();

/** Frozen base for later scientific and narrative review stages. Step 4 does
 * not dispatch either review; it only proves that both will consume the same
 * revision, atomic locations and current Evidence Card admission. */
export const GrantSemanticReviewBaseInputV1Schema = SemanticReviewV6InputHeaderSchema.extend({
  stage: z.literal("semantic_review"),
  sections: z.array(GrantDiagnosticAtomicSectionSchema).min(1),
  evidenceCards: z.array(GrantSemanticDiagnosticV3EvidenceInputSchema).max(8),
  priorFindings: z.array(PriorFindingReferenceSchema).max(100),
}).strict();

export type GrantFactMapModelInputV1 = z.infer<typeof GrantFactMapModelInputV1Schema>;
export type GrantSemanticReviewBaseInputV1 = z.infer<typeof GrantSemanticReviewBaseInputV1Schema>;

export type GrantSemanticReviewV6PreparedInputV1 = {
  sourceRevisionId: string;
  inputFingerprint: string;
  locationScopeFingerprint: string;
  factMapRequest: GrantFactMapModelInputV1;
  reviewBaseRequest: GrantSemanticReviewBaseInputV1;
  locationByRef: GrantHierarchicalDiagnosticPreparedInputV1["locationByRef"];
  locationRefByNodeId: GrantHierarchicalDiagnosticPreparedInputV1["locationRefByNodeId"];
  sectionIdByNodeId: GrantHierarchicalDiagnosticPreparedInputV1["sectionIdByNodeId"];
  allowedEvidenceCardIds: GrantHierarchicalDiagnosticPreparedInputV1["allowedEvidenceCardIds"];
  figureLocationRefByAssetId: GrantHierarchicalDiagnosticPreparedInputV1["figureLocationRefByAssetId"];
};

function inputFingerprint(input: {
  sourceRevisionId: string;
  factMapRequest: GrantFactMapModelInputV1;
  reviewBaseRequest: GrantSemanticReviewBaseInputV1;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/**
 * Adapts the already-authorized, already-aliased V5 prepared package into the
 * target V6 stages. It deliberately reuses the authoritative maps and does no
 * canonical parsing, evidence lookup, figure admission, provider call or DB
 * write.
 */
export function buildGrantSemanticReviewV6PreparedInputV1(input: {
  prepared: GrantHierarchicalDiagnosticPreparedInputV1;
}): GrantSemanticReviewV6PreparedInputV1 {
  const common = {
    contractVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapSchemaVersion,
    promptVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion,
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    documentLanguage: input.prepared.argumentMapRequest.documentLanguage,
    documentTitle: input.prepared.argumentMapRequest.documentTitle,
    fundingCategory: input.prepared.argumentMapRequest.fundingCategory,
    inputMode: input.prepared.argumentMapRequest.inputMode,
  } as const;

  const factMapRequest = GrantFactMapModelInputV1Schema.parse({
    ...common,
    stage: "fact_mapping",
    sections: input.prepared.argumentMapRequest.sections,
  });
  const reviewBaseRequest = GrantSemanticReviewBaseInputV1Schema.parse({
    ...common,
    stage: "semantic_review",
    sections: input.prepared.rootDiagnosisBaseRequest.sections,
    evidenceCards: input.prepared.rootDiagnosisBaseRequest.evidenceCards,
    priorFindings: input.prepared.rootDiagnosisBaseRequest.priorFindings,
  });
  const fingerprint = inputFingerprint({
    sourceRevisionId: input.prepared.sourceRevisionId,
    factMapRequest,
    reviewBaseRequest,
  });

  return {
    sourceRevisionId: input.prepared.sourceRevisionId,
    inputFingerprint: fingerprint,
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    factMapRequest,
    reviewBaseRequest,
    locationByRef: input.prepared.locationByRef,
    locationRefByNodeId: input.prepared.locationRefByNodeId,
    sectionIdByNodeId: input.prepared.sectionIdByNodeId,
    allowedEvidenceCardIds: input.prepared.allowedEvidenceCardIds,
    figureLocationRefByAssetId: input.prepared.figureLocationRefByAssetId,
  };
}
