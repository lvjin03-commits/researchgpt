import { z } from "zod";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
} from "./semantic-review-v6-contracts.ts";
import { GrantDiagnosticAtomicSectionSchema } from "./semantic-v3-input.ts";
import type { GrantDiagnosticImageAdmission } from "./multimodal-diagnostic-input.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "./semantic-review-v6-input.ts";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const LocationRefSchema = z.string().regex(/^N[1-9]\d*$/);
const ImageRefSchema = z.string().regex(/^I[1-9]\d*$/);

export const GrantNarrativeReviewModelInputV1Schema = z.object({
  contractVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion),
  schemaVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.narrativeFindingSchemaVersion),
  promptVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion),
  stage: z.literal("narrative_review"),
  locationScopeFingerprint: Sha256Schema,
  documentLanguage: z.enum(["zh", "en"]),
  documentTitle: z.string().trim().min(1),
  fundingCategory: z.string().trim().min(1).max(200),
  inputMode: z.enum(["full_document", "section_bundle", "focused_excerpt"]),
  sections: z.array(GrantDiagnosticAtomicSectionSchema).min(1),
  priorFindings: z.array(z.object({
    findingFingerprint: z.string().trim().min(1).max(128),
    category: z.string().trim().min(1).max(80),
    status: z.enum(["open", "closed", "superseded"]),
    locationRef: LocationRefSchema,
  }).strict()).max(100),
  imageCoverage: z.object({
    mode: z.enum(["text_only", "multimodal"]),
    candidateCount: z.number().int().nonnegative(),
    suppliedCount: z.number().int().nonnegative(),
    omittedCount: z.number().int().nonnegative(),
    imageScopeFingerprint: Sha256Schema,
  }).strict(),
  suppliedImages: z.array(z.object({
    imageRef: ImageRefSchema,
    locationRef: LocationRefSchema,
    caption: z.string().nullable(),
  }).strict()).max(8),
}).strict().superRefine((value, context) => {
  if (value.imageCoverage.suppliedCount !== value.suppliedImages.length) {
    context.addIssue({ code: "custom", path: ["imageCoverage", "suppliedCount"], message: "Image coverage must match supplied images." });
  }
  if ((value.imageCoverage.mode === "multimodal") !== (value.suppliedImages.length > 0)) {
    context.addIssue({ code: "custom", path: ["imageCoverage", "mode"], message: "Multimodal mode requires supplied images." });
  }
  const imageRefs = value.suppliedImages.map((image) => image.imageRef);
  if (new Set(imageRefs).size !== imageRefs.length) {
    context.addIssue({ code: "custom", path: ["suppliedImages"], message: "Image references must be unique." });
  }
});

export type GrantNarrativeReviewModelInputV1 = z.infer<typeof GrantNarrativeReviewModelInputV1Schema>;

export type GrantNarrativeReviewPreparedInputV1 = {
  request: GrantNarrativeReviewModelInputV1;
  imageAssetIdByRef: ReadonlyMap<string, string>;
};

export class GrantNarrativeReviewInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GrantNarrativeReviewInputError";
  }
}

/** Adds current request-local image coverage without rebuilding document
 * aliases or authorization. The admission must already have been materialized
 * by Grant Model Data Gateway immediately before the provider call. */
export function buildGrantNarrativeReviewModelInputV1(input: {
  prepared: GrantSemanticReviewV6PreparedInputV1;
  imageAdmission: GrantDiagnosticImageAdmission;
}): GrantNarrativeReviewPreparedInputV1 {
  const assetIdByLocationRef = new Map<string, string>();
  input.prepared.figureLocationRefByAssetId.forEach((locationRef, assetId) => {
    if (assetIdByLocationRef.has(locationRef)) {
      throw new GrantNarrativeReviewInputError("Figure locations must map to one canonical asset.");
    }
    assetIdByLocationRef.set(locationRef, assetId);
  });
  const imageAssetIdByRef = new Map<string, string>();
  for (const image of input.imageAdmission.images) {
    if (!input.prepared.locationByRef.has(image.locationRef)) {
      throw new GrantNarrativeReviewInputError("An admitted image is outside the frozen location scope.");
    }
    const assetId = assetIdByLocationRef.get(image.locationRef);
    if (!assetId) {
      throw new GrantNarrativeReviewInputError("An admitted image is not bound to a frozen figure asset.");
    }
    if (imageAssetIdByRef.has(image.imageRef)) {
      throw new GrantNarrativeReviewInputError("Image references must be unique in one execution.");
    }
    imageAssetIdByRef.set(image.imageRef, assetId);
  }

  const request = GrantNarrativeReviewModelInputV1Schema.parse({
    contractVersion: input.prepared.reviewBaseRequest.contractVersion,
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.narrativeFindingSchemaVersion,
    promptVersion: input.prepared.reviewBaseRequest.promptVersion,
    stage: "narrative_review",
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    documentLanguage: input.prepared.reviewBaseRequest.documentLanguage,
    documentTitle: input.prepared.reviewBaseRequest.documentTitle,
    fundingCategory: input.prepared.reviewBaseRequest.fundingCategory,
    inputMode: input.prepared.reviewBaseRequest.inputMode,
    sections: input.prepared.reviewBaseRequest.sections,
    priorFindings: input.prepared.reviewBaseRequest.priorFindings,
    imageCoverage: {
      mode: input.imageAdmission.coverage.mode,
      candidateCount: input.imageAdmission.coverage.candidateCount,
      suppliedCount: input.imageAdmission.coverage.suppliedCount,
      omittedCount: input.imageAdmission.coverage.omittedCount,
      imageScopeFingerprint: input.imageAdmission.coverage.imageScopeFingerprint,
    },
    suppliedImages: input.imageAdmission.images.map((image) => ({
      imageRef: image.imageRef,
      locationRef: image.locationRef,
      caption: image.caption,
    })),
  });
  return { request, imageAssetIdByRef };
}
