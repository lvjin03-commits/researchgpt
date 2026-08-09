import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { GrantSourceAnchorSchema } from "./contracts.ts";
import { createGrantSourceAnchor } from "./anchors.ts";
import {
  GrantSemanticDiagnosticResultV3Schema,
  GrantSemanticFindingContentV3Schema,
  assertGrantSemanticDiagnosticV3References,
  type GrantSemanticDiagnosticResultV3,
  type GrantSemanticDiagnosticV3ReferenceScope,
} from "./semantic-v3-contracts.ts";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1);
const AssembledLocationSchema = z.object({ sectionId: UuidSchema, nodeId: UuidSchema }).strict();

/** In-memory only; persistence remains a later, additive migration. */
export const AssembledGrantSemanticFindingV3Schema = GrantSemanticFindingContentV3Schema.safeExtend({
  findingId: UuidSchema,
  runId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  checkerId: TextSchema,
  checkerVersion: TextSchema,
  contractVersion: TextSchema,
  schemaVersion: TextSchema,
  policyVersion: TextSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  displayOrder: z.number().int().nonnegative(),
  primaryLocation: AssembledLocationSchema,
  sourceAnchor: GrantSourceAnchorSchema,
  lifecycleStatus: z.literal("open"),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type AssembledGrantSemanticFindingV3 = z.infer<typeof AssembledGrantSemanticFindingV3Schema>;

type Metadata = {
  runId: string;
  documentId: string;
  sourceRevisionId: string;
  checkerId: string;
  checkerVersion: string;
  contractVersion: string;
  schemaVersion: string;
  policyVersion: string;
};

type Position = { sectionIndex: number; nodeIndex: number };

function normalizeIdentityText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("zh-CN");
}

function canonicalPositions(snapshot: CanonicalGrantSnapshot): Map<string, Position> {
  const children = new Map<string | undefined, CanonicalGrantSnapshot["sections"]>();
  for (const section of snapshot.sections) {
    children.set(section.parentSectionId, [...(children.get(section.parentSectionId) ?? []), section]);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.order - b.order);
  const ordered: CanonicalGrantSnapshot["sections"] = [];
  const visit = (parent: string | undefined): void => {
    for (const section of children.get(parent) ?? []) {
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

function compareLocations(
  left: { nodeId: string; role?: string },
  right: { nodeId: string; role?: string },
  positions: ReadonlyMap<string, Position>,
): number {
  const a = positions.get(left.nodeId) ?? { sectionIndex: Number.MAX_SAFE_INTEGER, nodeIndex: Number.MAX_SAFE_INTEGER };
  const b = positions.get(right.nodeId) ?? { sectionIndex: Number.MAX_SAFE_INTEGER, nodeIndex: Number.MAX_SAFE_INTEGER };
  return a.sectionIndex - b.sectionIndex || a.nodeIndex - b.nodeIndex
    || (left.role ?? "").localeCompare(right.role ?? "") || left.nodeId.localeCompare(right.nodeId);
}

function normalizedRelatedLocations(
  finding: GrantSemanticDiagnosticResultV3["findings"][number],
  positions: ReadonlyMap<string, Position>,
) {
  return [...finding.relatedLocations].sort((a, b) => compareLocations(a, b, positions));
}

export function createGrantSemanticFindingV3Fingerprint(input: {
  checkerId: string;
  checkerVersion: string;
  contractVersion: string;
  finding: GrantSemanticDiagnosticResultV3["findings"][number];
  positions: ReadonlyMap<string, Position>;
}): string {
  return sha256Canonical({
    checkerId: input.checkerId,
    checkerVersion: input.checkerVersion,
    contractVersion: input.contractVersion,
    category: input.finding.category,
    primaryLocation: input.finding.primaryLocation,
    relatedLocations: normalizedRelatedLocations(input.finding, input.positions).map(({ sectionId, nodeId, role }) => ({
      sectionId, nodeId, role,
    })),
    diagnosticFact: normalizeIdentityText(input.finding.diagnosticFact),
  });
}

export function assembleGrantSemanticDiagnosticsV3(input: {
  metadata: Metadata;
  snapshot: CanonicalGrantSnapshot;
  result: GrantSemanticDiagnosticResultV3;
  referenceScope: GrantSemanticDiagnosticV3ReferenceScope;
  createId?: () => string;
  now?: () => string;
}): AssembledGrantSemanticFindingV3[] {
  const result = GrantSemanticDiagnosticResultV3Schema.parse(input.result);
  assertGrantSemanticDiagnosticV3References(result, input.referenceScope);
  const positions = canonicalPositions(input.snapshot);
  const createId = input.createId ?? randomUUID;
  const createdAt = (input.now ?? (() => new Date().toISOString()))();
  const ordered = result.findings.map((finding, modelOrder) => ({
    finding,
    modelOrder,
    relatedLocations: normalizedRelatedLocations(finding, positions),
    fingerprint: createGrantSemanticFindingV3Fingerprint({
      checkerId: input.metadata.checkerId,
      checkerVersion: input.metadata.checkerVersion,
      contractVersion: input.metadata.contractVersion,
      finding,
      positions,
    }),
  })).sort((a, b) => compareLocations(a.finding.primaryLocation, b.finding.primaryLocation, positions)
    || a.modelOrder - b.modelOrder);

  const seen = new Set<string>();
  const findings: AssembledGrantSemanticFindingV3[] = [];
  for (const item of ordered) {
    if (seen.has(item.fingerprint)) continue;
    seen.add(item.fingerprint);
    findings.push(AssembledGrantSemanticFindingV3Schema.parse({
      ...item.finding,
      ...input.metadata,
      findingId: createId(),
      fingerprint: item.fingerprint,
      displayOrder: findings.length,
      relatedLocations: item.relatedLocations,
      sourceAnchor: createGrantSourceAnchor({
        snapshot: input.snapshot,
        sourceRevisionId: input.metadata.sourceRevisionId,
        sectionId: item.finding.primaryLocation.sectionId,
        nodeId: item.finding.primaryLocation.nodeId,
      }),
      lifecycleStatus: "open",
      createdAt,
    }));
  }
  return findings;
}
