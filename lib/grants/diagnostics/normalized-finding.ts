import { z } from "zod";
import { GrantFindingAssessmentSchema, GrantSourceAnchorSchema, GrantFindingSchema, type GrantFinding } from "./contracts.ts";
import { AssembledGrantSemanticFindingV3Schema, type AssembledGrantSemanticFindingV3 } from "./semantic-v3-assembler.ts";
import { GrantSemanticDiagnosticCategoryV3Schema, GrantSemanticRelatedLocationRoleV3Schema } from "./semantic-v3-contracts.ts";
import { GrantArgumentRoleSchema, GrantEvidenceBasisSchema } from "./hierarchical-semantic-contracts.ts";
import { AssembledGrantHierarchicalFindingV1Schema, type AssembledGrantHierarchicalFindingV1 } from "./hierarchical-finding-assembler.ts";

const UuidSchema = z.string().uuid();

export const GrantNormalizedFindingSchema = z.object({
  findingId: UuidSchema,
  runId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  checkerId: z.string().trim().min(1),
  checkerVersion: z.string().trim().min(1),
  contractVersion: z.string().trim().min(1).nullable(),
  schemaVersion: z.enum(["grant-finding-v2", "grant-semantic-finding-v3", "grant-semantic-finding-v4"]),
  policyVersion: z.string().trim().min(1).nullable(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  category: z.union([GrantSemanticDiagnosticCategoryV3Schema, z.string().trim().min(1)]),
  title: z.string().trim().min(1).nullable(),
  diagnosticFact: z.string().trim().min(1),
  reason: z.string().trim().min(1).nullable(),
  recommendation: z.string().trim().min(1),
  possibleConsequence: z.string().trim().min(1).nullable(),
  assessment: GrantFindingAssessmentSchema,
  sourceAnchor: GrantSourceAnchorSchema,
  relatedLocations: z.array(z.object({
    sectionId: UuidSchema,
    nodeId: UuidSchema,
    role: GrantSemanticRelatedLocationRoleV3Schema,
    quote: z.string().trim().min(1).nullable(),
  }).strict()),
  affectedArgumentRoles: z.array(GrantArgumentRoleSchema).default([]),
  evidenceBasis: GrantEvidenceBasisSchema.nullable().default(null),
  rootOccurrences: z.array(z.object({
    occurrenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    primaryLocation: z.object({ sectionId: UuidSchema, nodeId: UuidSchema }).strict(),
    primarySourceAnchor: GrantSourceAnchorSchema,
    relatedLocations: z.array(z.object({
      sectionId: UuidSchema,
      nodeId: UuidSchema,
      role: GrantSemanticRelatedLocationRoleV3Schema,
      quote: z.string().trim().min(1).nullable(),
      sourceAnchor: GrantSourceAnchorSchema,
    }).strict()),
  }).strict()).default([]),
  usedEvidenceCardIds: z.array(UuidSchema),
  displayOrder: z.number().int().nonnegative().nullable(),
  lifecycleStatus: z.enum(["open", "closed", "superseded"]),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type GrantNormalizedFinding = z.infer<typeof GrantNormalizedFindingSchema>;

export function toGrantFindingCompatibility(finding: AssembledGrantSemanticFindingV3): GrantFinding {
  const parsed = AssembledGrantSemanticFindingV3Schema.parse(finding);
  return GrantFindingSchema.parse({
    findingId: parsed.findingId,
    runId: parsed.runId,
    documentId: parsed.documentId,
    sourceRevisionId: parsed.sourceRevisionId,
    checkerId: parsed.checkerId,
    checkerVersion: parsed.checkerVersion,
    fingerprint: parsed.fingerprint,
    code: parsed.category,
    message: parsed.diagnosticFact,
    recommendation: parsed.recommendation,
    assessment: parsed.assessment,
    sourceAnchor: parsed.sourceAnchor,
    lifecycleStatus: parsed.lifecycleStatus,
    createdAt: parsed.createdAt,
  });
}

export function normalizeGrantFindingV2(finding: GrantFinding): GrantNormalizedFinding {
  const parsed = GrantFindingSchema.parse(finding);
  return GrantNormalizedFindingSchema.parse({
    findingId: parsed.findingId,
    runId: parsed.runId,
    documentId: parsed.documentId,
    sourceRevisionId: parsed.sourceRevisionId,
    checkerId: parsed.checkerId,
    checkerVersion: parsed.checkerVersion,
    contractVersion: null,
    schemaVersion: "grant-finding-v2",
    policyVersion: null,
    fingerprint: parsed.fingerprint,
    category: parsed.code,
    title: null,
    diagnosticFact: parsed.message,
    reason: null,
    recommendation: parsed.recommendation,
    possibleConsequence: null,
    assessment: parsed.assessment,
    sourceAnchor: parsed.sourceAnchor,
    relatedLocations: [],
    affectedArgumentRoles: [],
    evidenceBasis: null,
    rootOccurrences: [],
    usedEvidenceCardIds: [],
    displayOrder: null,
    lifecycleStatus: parsed.lifecycleStatus,
    createdAt: parsed.createdAt,
  });
}

export function normalizeGrantFindingV3(finding: AssembledGrantSemanticFindingV3): GrantNormalizedFinding {
  const parsed = AssembledGrantSemanticFindingV3Schema.parse(finding);
  return GrantNormalizedFindingSchema.parse({
    findingId: parsed.findingId,
    runId: parsed.runId,
    documentId: parsed.documentId,
    sourceRevisionId: parsed.sourceRevisionId,
    checkerId: parsed.checkerId,
    checkerVersion: parsed.checkerVersion,
    contractVersion: parsed.contractVersion,
    schemaVersion: parsed.schemaVersion,
    policyVersion: parsed.policyVersion,
    fingerprint: parsed.fingerprint,
    category: parsed.category,
    title: parsed.title,
    diagnosticFact: parsed.diagnosticFact,
    reason: parsed.reason,
    recommendation: parsed.recommendation,
    possibleConsequence: parsed.possibleConsequence,
    assessment: parsed.assessment,
    sourceAnchor: parsed.sourceAnchor,
    relatedLocations: parsed.relatedLocations,
    affectedArgumentRoles: [],
    evidenceBasis: null,
    rootOccurrences: [],
    usedEvidenceCardIds: parsed.usedEvidenceCardIds,
    displayOrder: parsed.displayOrder,
    lifecycleStatus: parsed.lifecycleStatus,
    createdAt: parsed.createdAt,
  });
}

export function toGrantFindingHierarchicalCompatibility(finding: AssembledGrantHierarchicalFindingV1): GrantFinding {
  const parsed = AssembledGrantHierarchicalFindingV1Schema.parse(finding);
  return GrantFindingSchema.parse({
    findingId: parsed.findingId,
    runId: parsed.runId,
    documentId: parsed.documentId,
    sourceRevisionId: parsed.sourceRevisionId,
    checkerId: parsed.checkerId,
    checkerVersion: parsed.checkerVersion,
    fingerprint: parsed.fingerprint,
    code: parsed.category,
    message: parsed.diagnosticFact,
    recommendation: parsed.recommendation,
    assessment: parsed.assessment,
    sourceAnchor: parsed.sourceAnchor,
    lifecycleStatus: parsed.lifecycleStatus,
    createdAt: parsed.createdAt,
  });
}

export function normalizeGrantFindingHierarchical(finding: AssembledGrantHierarchicalFindingV1): GrantNormalizedFinding {
  const parsed = AssembledGrantHierarchicalFindingV1Schema.parse(finding);
  const firstOccurrence = parsed.occurrences[0]!;
  return GrantNormalizedFindingSchema.parse({
    findingId: parsed.findingId,
    runId: parsed.runId,
    documentId: parsed.documentId,
    sourceRevisionId: parsed.sourceRevisionId,
    checkerId: parsed.checkerId,
    checkerVersion: parsed.checkerVersion,
    contractVersion: parsed.contractVersion,
    schemaVersion: parsed.schemaVersion,
    policyVersion: parsed.policyVersion,
    fingerprint: parsed.fingerprint,
    category: parsed.category,
    title: parsed.title,
    diagnosticFact: parsed.diagnosticFact,
    reason: parsed.reason,
    recommendation: parsed.recommendation,
    possibleConsequence: parsed.possibleConsequence,
    assessment: parsed.assessment,
    sourceAnchor: parsed.sourceAnchor,
    relatedLocations: firstOccurrence.relatedLocations,
    affectedArgumentRoles: parsed.affectedArgumentRoles,
    evidenceBasis: parsed.evidenceBasis,
    rootOccurrences: parsed.occurrences,
    usedEvidenceCardIds: parsed.usedEvidenceCardIds,
    displayOrder: parsed.displayOrder,
    lifecycleStatus: parsed.lifecycleStatus,
    createdAt: parsed.createdAt,
  });
}
