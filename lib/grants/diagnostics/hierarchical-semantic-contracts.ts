import { z } from "zod";
import {
  GrantSemanticDiagnosticCategoryV3Schema,
  GrantSemanticRelatedLocationRoleV3Schema,
} from "./semantic-v3-contracts.ts";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedTextSchema = z.string().trim().min(1).max(2400);

/** Version authority for the hierarchical semantic diagnostic path. Runtime
 * cohort selection remains owned by server configuration, not this contract. */
export const GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS = {
  argumentMapSchemaVersion: "grant-argument-map-v1",
  providerContractVersion: "grant-semantic-diagnostic-v5",
  providerSchemaVersion: "grant-semantic-diagnostic-v5",
  promptVersion: "grant-semantic-review-v5.1",
  durableFindingSchemaVersion: "grant-semantic-finding-v4",
  policyVersion: "grant-ai-policy-v4",
  checkerVersion: "5.1.0",
} as const;

export const GrantArgumentRoleSchema = z.enum([
  "research_context",
  "domain_bottleneck",
  "knowledge_gap",
  "scientific_question",
  "central_hypothesis",
  "research_objective",
  "research_content",
  "technical_route",
  "feasibility_basis",
  "innovation_claim",
  "expected_contribution",
]);

export const GrantArgumentPresenceSchema = z.enum([
  "explicit",
  "implicit",
  "missing",
]);

export const GrantArgumentRelationSchema = z.enum([
  "motivates",
  "defines",
  "supports",
  "tests",
  "implements",
  "constrains",
  "claims_contribution_to",
]);

const ProviderArgumentModuleSchema = z.object({
  role: GrantArgumentRoleSchema,
  presence: GrantArgumentPresenceSchema,
  statement: z.string().nullable(),
  sourceLocationRefs: z.array(z.string()),
}).strict();

const ProviderArgumentRelationSchema = z.object({
  fromRole: GrantArgumentRoleSchema,
  toRole: GrantArgumentRoleSchema,
  relation: GrantArgumentRelationSchema,
  sourceLocationRefs: z.array(z.string()),
}).strict();

/**
 * Step A provider output. This is descriptive scaffolding only: it contains no
 * diagnosis, recommendation, severity, priority or funding prediction.
 */
export const GrantArgumentMapProviderResultV1Schema = z.object({
  modules: z.array(ProviderArgumentModuleSchema),
  relations: z.array(ProviderArgumentRelationSchema),
}).strict();

const CanonicalLocationSchema = z.object({
  sectionId: UuidSchema,
  nodeId: UuidSchema,
}).strict();

export const GrantArgumentMapV1Schema = z.object({
  schemaVersion: z.literal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion),
  sourceRevisionId: UuidSchema,
  modules: z.array(z.object({
    role: GrantArgumentRoleSchema,
    presence: GrantArgumentPresenceSchema,
    statement: z.string().trim().min(1).max(1600).nullable(),
    sourceLocations: z.array(CanonicalLocationSchema),
  }).strict()),
  relations: z.array(z.object({
    fromRole: GrantArgumentRoleSchema,
    toRole: GrantArgumentRoleSchema,
    relation: GrantArgumentRelationSchema,
    sourceLocations: z.array(CanonicalLocationSchema),
  }).strict()),
}).strict().superRefine((value, context) => {
  const seenRoles = new Set<string>();
  for (const [index, module] of value.modules.entries()) {
    if (seenRoles.has(module.role)) {
      context.addIssue({
        code: "custom",
        path: ["modules", index, "role"],
        message: "Each argument role must occur exactly once.",
      });
    }
    seenRoles.add(module.role);
    if (module.presence === "missing" && (module.statement !== null || module.sourceLocations.length > 0)) {
      context.addIssue({
        code: "custom",
        path: ["modules", index],
        message: "A missing argument role cannot claim a statement or source location.",
      });
    }
    if (module.presence !== "missing" && (module.statement === null || module.sourceLocations.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["modules", index],
        message: "An explicit or implicit argument role requires a statement and source location.",
      });
    }
  }
  for (const role of GrantArgumentRoleSchema.options) {
    if (!seenRoles.has(role)) {
      context.addIssue({
        code: "custom",
        path: ["modules"],
        message: `Argument map must include role ${role}.`,
      });
    }
  }
  for (const [index, relation] of value.relations.entries()) {
    if (relation.fromRole === relation.toRole) {
      context.addIssue({
        code: "custom",
        path: ["relations", index],
        message: "An argument relation cannot connect a role to itself.",
      });
    }
    if (relation.sourceLocations.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["relations", index, "sourceLocations"],
        message: "An argument relation requires at least one source location.",
      });
    }
  }
});

const ProviderAssessmentSchema = z.object({
  scope: z.enum(["cross_section", "section", "paragraph", "sentence", "term_or_citation"]),
  confidence: z.number(),
  actionability: z.enum(["directly_actionable", "requires_evidence", "requires_expert_judgment"]),
}).strict();

const ProviderRelatedLocationSchema = z.object({
  locationRef: z.string(),
  role: GrantSemanticRelatedLocationRoleV3Schema,
  quote: z.string().nullable(),
}).strict();

const ProviderOccurrenceSchema = z.object({
  primaryLocationRef: z.string(),
  relatedLocations: z.array(ProviderRelatedLocationSchema),
}).strict();

export const GrantEvidenceBasisSchema = z.enum([
  "document_only",
  "authorized_evidence",
  "requires_external_verification",
]);

/** Step B provider output. One root issue owns one or more source occurrences. */
export const GrantRootDiagnosticProviderResultV1Schema = z.object({
  rootFindings: z.array(z.object({
    category: GrantSemanticDiagnosticCategoryV3Schema,
    affectedArgumentRoles: z.array(GrantArgumentRoleSchema),
    title: z.string(),
    diagnosticFact: z.string(),
    reason: z.string(),
    recommendation: z.string(),
    possibleConsequence: z.string().nullable(),
    assessment: ProviderAssessmentSchema,
    occurrences: z.array(ProviderOccurrenceSchema),
    evidenceBasis: GrantEvidenceBasisSchema,
    usedEvidenceCardIds: z.array(z.string()),
  }).strict()),
}).strict();

const ProgramRelatedLocationSchema = CanonicalLocationSchema.extend({
  role: GrantSemanticRelatedLocationRoleV3Schema,
  quote: z.string().trim().min(1).max(800).nullable(),
}).strict();

export const GrantRootFindingContentV1Schema = z.object({
  category: GrantSemanticDiagnosticCategoryV3Schema,
  affectedArgumentRoles: z.array(GrantArgumentRoleSchema).min(1),
  title: z.string().trim().min(1).max(240),
  diagnosticFact: BoundedTextSchema,
  reason: BoundedTextSchema,
  recommendation: BoundedTextSchema,
  possibleConsequence: z.string().trim().min(1).max(1600).nullable(),
  assessment: z.object({
    scope: z.enum(["cross_section", "section", "paragraph", "sentence", "term_or_citation"]),
    confidence: z.number().min(0).max(1),
    actionability: z.enum(["directly_actionable", "requires_evidence", "requires_expert_judgment"]),
  }).strict(),
  occurrences: z.array(z.object({
    primaryLocation: CanonicalLocationSchema,
    relatedLocations: z.array(ProgramRelatedLocationSchema).max(12),
  }).strict()).min(1).max(24),
  evidenceBasis: GrantEvidenceBasisSchema,
  usedEvidenceCardIds: z.array(UuidSchema).max(24),
}).strict().superRefine((finding, context) => {
  if (new Set(finding.affectedArgumentRoles).size !== finding.affectedArgumentRoles.length) {
    context.addIssue({ code: "custom", path: ["affectedArgumentRoles"], message: "Affected argument roles must be unique." });
  }
  if (finding.evidenceBasis === "authorized_evidence" && finding.usedEvidenceCardIds.length === 0) {
    context.addIssue({ code: "custom", path: ["usedEvidenceCardIds"], message: "Authorized-evidence findings must name at least one Evidence Card." });
  }
  if (finding.evidenceBasis === "document_only" && finding.usedEvidenceCardIds.length > 0) {
    context.addIssue({ code: "custom", path: ["usedEvidenceCardIds"], message: "Document-only findings cannot claim an Evidence Card." });
  }
  if (finding.category === "cross_section_inconsistency") {
    const hasCrossNodeContext = finding.occurrences.length > 1
      || finding.occurrences.some((occurrence) => occurrence.relatedLocations.length > 0);
    if (!hasCrossNodeContext) {
      context.addIssue({ code: "custom", path: ["occurrences"], message: "Cross-section findings require more than one source location." });
    }
  }
});

export const GrantRootDiagnosticResultV1Schema = z.object({
  rootFindings: z.array(GrantRootFindingContentV1Schema).max(16),
}).strict();

/**
 * Cross-revision occurrence identity. Execution-local locationRef values,
 * ArgumentMap statements and model wording are intentionally impossible here.
 */
export const GrantOccurrenceContinuityIdentityV1Schema = z.object({
  checkerId: z.string().trim().min(1),
  checkerVersion: z.string().trim().min(1),
  category: GrantSemanticDiagnosticCategoryV3Schema,
  primaryNodeId: UuidSchema,
  relatedLocations: z.array(z.object({
    nodeId: UuidSchema,
    role: GrantSemanticRelatedLocationRoleV3Schema,
  }).strict()),
}).strict();

export const GrantRootContinuityIdentityV1Schema = z.object({
  checkerId: z.string().trim().min(1),
  checkerVersion: z.string().trim().min(1),
  category: GrantSemanticDiagnosticCategoryV3Schema,
  affectedArgumentRoles: z.array(GrantArgumentRoleSchema).min(1),
  occurrenceFingerprints: z.array(Sha256Schema).min(1),
}).strict();

export const GrantHierarchicalDiagnosticStageSchema = z.enum([
  "argument_mapping",
  "root_diagnosis",
  "assembly",
]);

export const GrantHierarchicalDiagnosticStageStatusSchema = z.enum([
  "not_started",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "stale",
]);

export const GrantHierarchicalDiagnosticFailureCodeSchema = z.enum([
  "argument_map_output_truncated",
  "argument_map_structured_output_invalid",
  "argument_map_reference_invalid",
  "argument_map_provider_failure",
  "root_diagnosis_output_truncated",
  "root_diagnosis_structured_output_invalid",
  "root_diagnosis_reference_invalid",
  "root_diagnosis_evidence_invalid",
  "root_diagnosis_provider_failure",
  "diagnostic_base_revision_stale",
]);

export const GrantHierarchicalDiagnosticStageStateSchema = z.object({
  stage: GrantHierarchicalDiagnosticStageSchema,
  status: GrantHierarchicalDiagnosticStageStatusSchema,
  sourceRevisionId: UuidSchema,
  failureCode: GrantHierarchicalDiagnosticFailureCodeSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === "failed" && value.failureCode === null) {
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "A failed diagnostic stage requires a failure code.",
    });
  }
  if (value.status === "stale" && value.failureCode !== "diagnostic_base_revision_stale") {
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "A stale diagnostic stage requires diagnostic_base_revision_stale.",
    });
  }
  if (!["failed", "stale"].includes(value.status) && value.failureCode !== null) {
    context.addIssue({
      code: "custom",
      path: ["failureCode"],
      message: "Only failed or stale diagnostic stages may carry a failure code.",
    });
  }
});

/** Durable recovery point for a paid Step A result. It is revision and scope
 * bound, and cannot be reused as cross-run Finding identity. */
export const GrantArgumentMapCheckpointV1Schema = z.object({
  checkpointId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  checkerId: z.string().trim().min(1),
  checkerVersion: z.string().trim().min(1),
  contractVersion: z.literal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion),
  inputFingerprint: Sha256Schema,
  locationScopeFingerprint: Sha256Schema,
  argumentMap: GrantArgumentMapV1Schema,
  status: z.enum(["ready", "consumed", "superseded"]),
  createdAt: z.string().datetime({ offset: true }),
}).strict().superRefine((value, context) => {
  if (value.argumentMap.sourceRevisionId !== value.sourceRevisionId) {
    context.addIssue({ code: "custom", path: ["argumentMap", "sourceRevisionId"], message: "Checkpoint and ArgumentMap revisions must match." });
  }
});

export const GrantHierarchicalContinuityLinkV1Schema = z.object({
  findingId: UuidSchema,
  previousFindingId: UuidSchema,
  previousRootFingerprint: Sha256Schema,
  match: z.enum(["exact", "relocated"]),
}).strict();

export type GrantArgumentRole = z.infer<typeof GrantArgumentRoleSchema>;
export type GrantArgumentMapProviderResultV1 = z.infer<typeof GrantArgumentMapProviderResultV1Schema>;
export type GrantArgumentMapV1 = z.infer<typeof GrantArgumentMapV1Schema>;
export type GrantRootDiagnosticProviderResultV1 = z.infer<typeof GrantRootDiagnosticProviderResultV1Schema>;
export type GrantRootFindingContentV1 = z.infer<typeof GrantRootFindingContentV1Schema>;
export type GrantRootDiagnosticResultV1 = z.infer<typeof GrantRootDiagnosticResultV1Schema>;
export type GrantOccurrenceContinuityIdentityV1 = z.infer<typeof GrantOccurrenceContinuityIdentityV1Schema>;
export type GrantRootContinuityIdentityV1 = z.infer<typeof GrantRootContinuityIdentityV1Schema>;
export type GrantHierarchicalDiagnosticStageState = z.infer<typeof GrantHierarchicalDiagnosticStageStateSchema>;
export type GrantArgumentMapCheckpointV1 = z.infer<typeof GrantArgumentMapCheckpointV1Schema>;
export type GrantHierarchicalContinuityLinkV1 = z.infer<typeof GrantHierarchicalContinuityLinkV1Schema>;
