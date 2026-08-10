import { createHash } from "node:crypto";
import { z } from "zod";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  GrantArgumentMapProviderResultV1Schema,
  type GrantArgumentMapV1,
} from "./hierarchical-semantic-contracts.ts";
import {
  GrantDiagnosticAtomicSectionSchema,
  GrantSemanticDiagnosticV3EvidenceInputSchema,
  type GrantSemanticDiagnosticV3PreparedInput,
} from "./semantic-v3-input.ts";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const LocationRefSchema = z.string().regex(/^N[1-9]\d*$/);

const PriorFindingReferenceSchema = z.object({
  findingFingerprint: z.string().trim().min(1).max(128),
  category: z.string().trim().min(1).max(80),
  status: z.enum(["open", "closed", "superseded"]),
  locationRef: LocationRefSchema,
}).strict();

const HierarchicalInputHeaderSchema = z.object({
  contractVersion: z.literal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion),
  locationScopeFingerprint: Sha256Schema,
  documentLanguage: z.enum(["zh", "en"]),
  documentTitle: z.string().trim().min(1),
  fundingCategory: z.string().trim().min(1).max(200),
  inputMode: z.enum(["full_document", "section_bundle", "focused_excerpt"]),
}).strict();

export const GrantArgumentMapModelInputV1Schema = HierarchicalInputHeaderSchema.extend({
  stage: z.literal("argument_mapping"),
  sections: z.array(GrantDiagnosticAtomicSectionSchema).min(1),
}).strict();

/**
 * The immutable document/evidence portion of step B. Step 3 will attach the
 * validated ArgumentMap to this base without rebuilding its location scope.
 */
export const GrantRootDiagnosticBaseInputV1Schema = HierarchicalInputHeaderSchema.extend({
  stage: z.literal("root_diagnosis"),
  sections: z.array(GrantDiagnosticAtomicSectionSchema).min(1),
  evidenceCards: z.array(GrantSemanticDiagnosticV3EvidenceInputSchema).max(8),
  priorFindings: z.array(PriorFindingReferenceSchema).max(100),
}).strict();

export const GrantRootDiagnosticModelInputV1Schema = GrantRootDiagnosticBaseInputV1Schema.extend({
  argumentMap: GrantArgumentMapProviderResultV1Schema,
}).strict();

export type GrantArgumentMapModelInputV1 = z.infer<typeof GrantArgumentMapModelInputV1Schema>;
export type GrantRootDiagnosticBaseInputV1 = z.infer<typeof GrantRootDiagnosticBaseInputV1Schema>;
export type GrantRootDiagnosticModelInputV1 = z.infer<typeof GrantRootDiagnosticModelInputV1Schema>;

export type GrantHierarchicalDiagnosticPreparedInputV1 = {
  sourceRevisionId: string;
  locationScopeFingerprint: string;
  argumentMapRequest: GrantArgumentMapModelInputV1;
  rootDiagnosisBaseRequest: GrantRootDiagnosticBaseInputV1;
  locationByRef: GrantSemanticDiagnosticV3PreparedInput["locationByRef"];
  locationRefByNodeId: GrantSemanticDiagnosticV3PreparedInput["locationRefByNodeId"];
  sectionIdByNodeId: GrantSemanticDiagnosticV3PreparedInput["sectionIdByNodeId"];
  allowedEvidenceCardIds: GrantSemanticDiagnosticV3PreparedInput["allowedEvidenceCardIds"];
  figureLocationRefByAssetId: GrantSemanticDiagnosticV3PreparedInput["figureLocationRefByAssetId"];
};

function locationScopeFingerprint(input: {
  sourceRevisionId: string;
  prepared: GrantSemanticDiagnosticV3PreparedInput;
}): string {
  const canonicalLocations = [...input.prepared.locationByRef.entries()]
    .sort(([left], [right]) => Number(left.slice(1)) - Number(right.slice(1)))
    .map(([locationRef, location]) => ({ locationRef, ...location }));
  return createHash("sha256").update(JSON.stringify({
    sourceRevisionId: input.sourceRevisionId,
    sections: input.prepared.request.sections,
    canonicalLocations,
  })).digest("hex");
}

/**
 * Adapts one already-authorized V4 prepared input into the V5 two-stage input
 * package. No provider call, evidence lookup, location remapping or database
 * write occurs here.
 */
export function buildGrantHierarchicalDiagnosticPreparedInputV1(input: {
  sourceRevisionId: string;
  prepared: GrantSemanticDiagnosticV3PreparedInput;
}): GrantHierarchicalDiagnosticPreparedInputV1 {
  UuidSchema.parse(input.sourceRevisionId);
  const fingerprint = locationScopeFingerprint(input);
  const header = {
    contractVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion,
    locationScopeFingerprint: fingerprint,
    documentLanguage: input.prepared.request.documentLanguage,
    documentTitle: input.prepared.request.documentTitle,
    fundingCategory: input.prepared.request.fundingCategory,
    inputMode: input.prepared.request.inputMode,
  } as const;

  const argumentMapRequest = GrantArgumentMapModelInputV1Schema.parse({
    ...header,
    stage: "argument_mapping",
    sections: input.prepared.request.sections,
  });
  const rootDiagnosisBaseRequest = GrantRootDiagnosticBaseInputV1Schema.parse({
    ...header,
    stage: "root_diagnosis",
    sections: input.prepared.request.sections,
    evidenceCards: input.prepared.request.evidenceCards,
    priorFindings: input.prepared.request.priorFindings,
  });

  return {
    sourceRevisionId: input.sourceRevisionId,
    locationScopeFingerprint: fingerprint,
    argumentMapRequest,
    rootDiagnosisBaseRequest,
    locationByRef: input.prepared.locationByRef,
    locationRefByNodeId: input.prepared.locationRefByNodeId,
    sectionIdByNodeId: input.prepared.sectionIdByNodeId,
    allowedEvidenceCardIds: input.prepared.allowedEvidenceCardIds,
    figureLocationRefByAssetId: input.prepared.figureLocationRefByAssetId,
  };
}

/** Builds Step B input from the validated Step A map without exposing UUIDs. */
export function buildGrantRootDiagnosticModelInputV1(input: {
  prepared: GrantHierarchicalDiagnosticPreparedInputV1;
  argumentMap: GrantArgumentMapV1;
}): GrantRootDiagnosticModelInputV1 {
  if (input.argumentMap.sourceRevisionId !== input.prepared.sourceRevisionId) {
    throw new Error("ArgumentMap source revision does not match the frozen diagnostic input.");
  }
  const toRefs = (locations: Array<{ sectionId: string; nodeId: string }>): string[] => locations.map((location) => {
    const locationRef = input.prepared.locationRefByNodeId.get(location.nodeId);
    const canonical = locationRef ? input.prepared.locationByRef.get(locationRef) : undefined;
    if (!locationRef || canonical?.sectionId !== location.sectionId) {
      throw new Error("ArgumentMap contains a location outside the frozen diagnostic input.");
    }
    return locationRef;
  });
  return GrantRootDiagnosticModelInputV1Schema.parse({
    ...input.prepared.rootDiagnosisBaseRequest,
    argumentMap: {
      modules: input.argumentMap.modules.map((module) => ({
        role: module.role,
        presence: module.presence,
        statement: module.statement,
        sourceLocationRefs: toRefs(module.sourceLocations),
      })),
      relations: input.argumentMap.relations.map((relation) => ({
        fromRole: relation.fromRole,
        toRole: relation.toRole,
        relation: relation.relation,
        sourceLocationRefs: toRefs(relation.sourceLocations),
      })),
    },
  });
}
