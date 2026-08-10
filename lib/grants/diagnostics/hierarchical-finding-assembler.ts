import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { createGrantSourceAnchor } from "./anchors.ts";
import { GrantSourceAnchorSchema } from "./contracts.ts";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  GrantArgumentRoleSchema,
  GrantEvidenceBasisSchema,
  GrantRootDiagnosticResultV1Schema,
  type GrantRootDiagnosticResultV1,
} from "./hierarchical-semantic-contracts.ts";
import { GrantSemanticRelatedLocationRoleV3Schema } from "./semantic-v3-contracts.ts";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const LocationSchema = z.object({ sectionId: UuidSchema, nodeId: UuidSchema }).strict();

const AssembledOccurrenceSchema = z.object({
  occurrenceFingerprint: Sha256Schema,
  primaryLocation: LocationSchema,
  primarySourceAnchor: GrantSourceAnchorSchema,
  relatedLocations: z.array(LocationSchema.extend({
    role: GrantSemanticRelatedLocationRoleV3Schema,
    quote: z.string().trim().min(1).max(800).nullable(),
    sourceAnchor: GrantSourceAnchorSchema,
  }).strict()),
}).strict();

export const AssembledGrantHierarchicalFindingV1Schema = z.object({
  findingId: UuidSchema,
  runId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  checkerId: z.string().trim().min(1),
  checkerVersion: z.string().trim().min(1),
  contractVersion: z.literal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion),
  schemaVersion: z.literal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.durableFindingSchemaVersion),
  policyVersion: z.literal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.policyVersion),
  fingerprint: Sha256Schema,
  rootFingerprint: Sha256Schema,
  category: z.string().trim().min(1),
  affectedArgumentRoles: z.array(GrantArgumentRoleSchema).min(1),
  title: z.string().trim().min(1),
  diagnosticFact: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  recommendation: z.string().trim().min(1),
  possibleConsequence: z.string().trim().min(1).nullable(),
  assessment: z.object({
    scope: z.enum(["cross_section", "section", "paragraph", "sentence", "term_or_citation"]),
    confidence: z.number().min(0).max(1),
    actionability: z.enum(["directly_actionable", "requires_evidence", "requires_expert_judgment"]),
  }).strict(),
  occurrences: z.array(AssembledOccurrenceSchema).min(1),
  evidenceBasis: GrantEvidenceBasisSchema,
  usedEvidenceCardIds: z.array(UuidSchema),
  displayOrder: z.number().int().nonnegative(),
  sourceAnchor: GrantSourceAnchorSchema,
  lifecycleStatus: z.literal("open"),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type AssembledGrantHierarchicalFindingV1 = z.infer<typeof AssembledGrantHierarchicalFindingV1Schema>;

type Position = { sectionIndex: number; nodeIndex: number };

function positions(snapshot: CanonicalGrantSnapshot): Map<string, Position> {
  const children = new Map<string | undefined, CanonicalGrantSnapshot["sections"]>();
  for (const section of snapshot.sections) {
    children.set(section.parentSectionId, [...(children.get(section.parentSectionId) ?? []), section]);
  }
  for (const siblings of children.values()) siblings.sort((left, right) => left.order - right.order || left.sectionId.localeCompare(right.sectionId));
  const ordered: CanonicalGrantSnapshot["sections"] = [];
  const visit = (parentSectionId: string | undefined): void => {
    for (const section of children.get(parentSectionId) ?? []) {
      ordered.push(section);
      visit(section.sectionId);
    }
  };
  visit(undefined);
  const sectionOrder = new Map(ordered.map((section, index) => [section.sectionId, index]));
  return new Map(snapshot.nodes.map((node) => [node.nodeId, {
    sectionIndex: sectionOrder.get(node.sectionId) ?? Number.MAX_SAFE_INTEGER,
    nodeIndex: node.order,
  }]));
}

function compareNodes(left: string, right: string, order: ReadonlyMap<string, Position>): number {
  const a = order.get(left) ?? { sectionIndex: Number.MAX_SAFE_INTEGER, nodeIndex: Number.MAX_SAFE_INTEGER };
  const b = order.get(right) ?? { sectionIndex: Number.MAX_SAFE_INTEGER, nodeIndex: Number.MAX_SAFE_INTEGER };
  return a.sectionIndex - b.sectionIndex || a.nodeIndex - b.nodeIndex || left.localeCompare(right);
}

export function createGrantOccurrenceFingerprintV1(input: {
  checkerId: string;
  checkerVersion: string;
  category: string;
  occurrence: GrantRootDiagnosticResultV1["rootFindings"][number]["occurrences"][number];
}): string {
  return sha256Canonical({
    checkerId: input.checkerId,
    checkerVersion: input.checkerVersion,
    category: input.category,
    primaryNodeId: input.occurrence.primaryLocation.nodeId,
    relatedLocations: input.occurrence.relatedLocations
      .map(({ nodeId, role }) => ({ nodeId, role }))
      .sort((left, right) => left.nodeId.localeCompare(right.nodeId) || left.role.localeCompare(right.role)),
  });
}

export function createGrantRootFingerprintV1(input: {
  checkerId: string;
  checkerVersion: string;
  category: string;
  affectedArgumentRoles: string[];
  occurrenceFingerprints: string[];
}): string {
  return sha256Canonical({
    checkerId: input.checkerId,
    checkerVersion: input.checkerVersion,
    category: input.category,
    affectedArgumentRoles: [...input.affectedArgumentRoles].sort(),
    occurrenceFingerprints: [...input.occurrenceFingerprints].sort(),
  });
}

export function assembleGrantHierarchicalFindingsV1(input: {
  runId: string;
  documentId: string;
  sourceRevisionId: string;
  checkerId: string;
  checkerVersion: string;
  snapshot: CanonicalGrantSnapshot;
  result: GrantRootDiagnosticResultV1;
  createId?: () => string;
  now?: () => string;
}): AssembledGrantHierarchicalFindingV1[] {
  const result = GrantRootDiagnosticResultV1Schema.parse(input.result);
  const nodeOrder = positions(input.snapshot);
  const createdAt = (input.now ?? (() => new Date().toISOString()))();
  const createId = input.createId ?? randomUUID;
  const candidates = result.rootFindings.map((finding, modelOrder) => {
    const occurrences = finding.occurrences.map((occurrence) => ({
      ...occurrence,
      primarySourceAnchor: createGrantSourceAnchor({
        snapshot: input.snapshot,
        sourceRevisionId: input.sourceRevisionId,
        sectionId: occurrence.primaryLocation.sectionId,
        nodeId: occurrence.primaryLocation.nodeId,
      }),
      relatedLocations: [...occurrence.relatedLocations].sort((left, right) =>
        compareNodes(left.nodeId, right.nodeId, nodeOrder) || left.role.localeCompare(right.role))
        .map((related) => ({
          ...related,
          sourceAnchor: createGrantSourceAnchor({
            snapshot: input.snapshot,
            sourceRevisionId: input.sourceRevisionId,
            sectionId: related.sectionId,
            nodeId: related.nodeId,
          }),
        })),
      occurrenceFingerprint: createGrantOccurrenceFingerprintV1({
        checkerId: input.checkerId,
        checkerVersion: input.checkerVersion,
        category: finding.category,
        occurrence,
      }),
    })).sort((left, right) => compareNodes(left.primaryLocation.nodeId, right.primaryLocation.nodeId, nodeOrder));
    const rootFingerprint = createGrantRootFingerprintV1({
      checkerId: input.checkerId,
      checkerVersion: input.checkerVersion,
      category: finding.category,
      affectedArgumentRoles: finding.affectedArgumentRoles,
      occurrenceFingerprints: occurrences.map((occurrence) => occurrence.occurrenceFingerprint),
    });
    return { finding, occurrences, rootFingerprint, modelOrder };
  }).sort((left, right) => compareNodes(
    left.occurrences[0]!.primaryLocation.nodeId,
    right.occurrences[0]!.primaryLocation.nodeId,
    nodeOrder,
  ) || left.modelOrder - right.modelOrder);

  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    if (seen.has(candidate.rootFingerprint)) return [];
    seen.add(candidate.rootFingerprint);
    const primary = candidate.occurrences[0]!.primaryLocation;
    return [AssembledGrantHierarchicalFindingV1Schema.parse({
      ...candidate.finding,
      findingId: createId(),
      runId: input.runId,
      documentId: input.documentId,
      sourceRevisionId: input.sourceRevisionId,
      checkerId: input.checkerId,
      checkerVersion: input.checkerVersion,
      contractVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion,
      schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.durableFindingSchemaVersion,
      policyVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.policyVersion,
      fingerprint: candidate.rootFingerprint,
      rootFingerprint: candidate.rootFingerprint,
      occurrences: candidate.occurrences,
      displayOrder: seen.size - 1,
      sourceAnchor: createGrantSourceAnchor({
        snapshot: input.snapshot,
        sourceRevisionId: input.sourceRevisionId,
        sectionId: primary.sectionId,
        nodeId: primary.nodeId,
      }),
      lifecycleStatus: "open",
      createdAt,
    })];
  });
}
