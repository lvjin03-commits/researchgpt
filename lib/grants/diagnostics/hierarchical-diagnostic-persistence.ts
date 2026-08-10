import { randomUUID } from "node:crypto";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { GrantDiagnosticRunSchema } from "./contracts.ts";
import {
  GrantArgumentMapCheckpointV1Schema,
  GrantHierarchicalContinuityLinkV1Schema,
  type GrantArgumentMapCheckpointV1,
  type GrantHierarchicalContinuityLinkV1,
} from "./hierarchical-semantic-contracts.ts";
import type { GrantHierarchicalDiagnosticPreparedInputV1 } from "./hierarchical-semantic-input.ts";
import { assembleGrantHierarchicalFindingsV1, createGrantOccurrenceFingerprintV1, createGrantRootFingerprintV1, type AssembledGrantHierarchicalFindingV1 } from "./hierarchical-finding-assembler.ts";
import type { GrantHierarchicalDiagnosticExecutionV1 } from "../ports/grant-diagnostic-repository.ts";
import type { GrantNormalizedFinding } from "./normalized-finding.ts";
import { resolveGrantSourceAnchor } from "./anchors.ts";
import type { GrantDiagnosticImageCoverage } from "./multimodal-diagnostic-input.ts";

type HierarchicalExecutionResult = {
  argumentMap: GrantArgumentMapCheckpointV1["argumentMap"];
  rootDiagnosis: Parameters<typeof assembleGrantHierarchicalFindingsV1>[0]["result"];
  providerCallCount: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  resumedFromArgumentMap: boolean;
  imageCoverage: GrantDiagnosticImageCoverage;
};

export function grantHierarchicalDiagnosticInputFingerprintV1(
  prepared: GrantHierarchicalDiagnosticPreparedInputV1,
): string {
  return sha256Canonical({
    sourceRevisionId: prepared.sourceRevisionId,
    locationScopeFingerprint: prepared.locationScopeFingerprint,
    argumentMapRequest: prepared.argumentMapRequest,
    rootDiagnosisBaseRequest: prepared.rootDiagnosisBaseRequest,
    figureScope: [...prepared.figureLocationRefByAssetId.entries()]
      .sort(([left], [right]) => left.localeCompare(right)),
  });
}

export function createGrantArgumentMapCheckpointV1(input: {
  documentId: string;
  checkerId: string;
  checkerVersion: string;
  prepared: GrantHierarchicalDiagnosticPreparedInputV1;
  argumentMap: GrantArgumentMapCheckpointV1["argumentMap"];
  status?: GrantArgumentMapCheckpointV1["status"];
  checkpointId?: string;
  now?: () => string;
}): GrantArgumentMapCheckpointV1 {
  return GrantArgumentMapCheckpointV1Schema.parse({
    checkpointId: input.checkpointId ?? randomUUID(),
    documentId: input.documentId,
    sourceRevisionId: input.prepared.sourceRevisionId,
    checkerId: input.checkerId,
    checkerVersion: input.checkerVersion,
    contractVersion: input.prepared.argumentMapRequest.contractVersion,
    inputFingerprint: grantHierarchicalDiagnosticInputFingerprintV1(input.prepared),
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    argumentMap: input.argumentMap,
    status: input.status ?? "ready",
    createdAt: (input.now ?? (() => new Date().toISOString()))(),
  });
}

export function linkGrantHierarchicalContinuityV1(input: {
  currentFindings: AssembledGrantHierarchicalFindingV1[];
  previousFindings: GrantNormalizedFinding[];
  targetRevisionId: string;
  targetSnapshot: CanonicalGrantSnapshot;
}): GrantHierarchicalContinuityLinkV1[] {
  const currentByFingerprint = new Map(input.currentFindings.map((finding) => [finding.rootFingerprint, finding]));
  const nodeSection = new Map(input.targetSnapshot.nodes.map((node) => [node.nodeId, node.sectionId]));
  const links: GrantHierarchicalContinuityLinkV1[] = [];
  for (const previous of input.previousFindings) {
    if (previous.schemaVersion !== "grant-semantic-finding-v4" || previous.rootOccurrences.length === 0) continue;
    const occurrenceFingerprints = previous.rootOccurrences.flatMap((occurrence) => {
      const primary = resolveGrantSourceAnchor(occurrence.primarySourceAnchor, input.targetRevisionId, input.targetSnapshot);
      if ((primary.status !== "exact" && primary.status !== "relocated") || !primary.targetNodeId) return [];
      const sectionId = nodeSection.get(primary.targetNodeId);
      if (!sectionId) return [];
      const relatedLocations = occurrence.relatedLocations.flatMap((related) => {
        const resolution = resolveGrantSourceAnchor(related.sourceAnchor, input.targetRevisionId, input.targetSnapshot);
        if ((resolution.status !== "exact" && resolution.status !== "relocated") || !resolution.targetNodeId) return [];
        const relatedSectionId = nodeSection.get(resolution.targetNodeId);
        return relatedSectionId ? [{ sectionId: relatedSectionId, nodeId: resolution.targetNodeId, role: related.role, quote: related.quote }] : [];
      });
      return [createGrantOccurrenceFingerprintV1({
        checkerId: previous.checkerId,
        checkerVersion: previous.checkerVersion,
        category: previous.category,
        occurrence: { primaryLocation: { sectionId, nodeId: primary.targetNodeId }, relatedLocations },
      })];
    });
    if (occurrenceFingerprints.length === 0) continue;
    const relocatedRoot = createGrantRootFingerprintV1({
      checkerId: previous.checkerId,
      checkerVersion: previous.checkerVersion,
      category: previous.category,
      affectedArgumentRoles: previous.affectedArgumentRoles,
      occurrenceFingerprints,
    });
    const current = currentByFingerprint.get(relocatedRoot);
    if (!current) continue;
    links.push(GrantHierarchicalContinuityLinkV1Schema.parse({
      findingId: current.findingId,
      previousFindingId: previous.findingId,
      previousRootFingerprint: previous.fingerprint,
      match: previous.fingerprint === relocatedRoot ? "exact" : "relocated",
    }));
  }
  return links;
}

/**
 * Builds one atomic repository payload. It does not write to the repository;
 * callers must still verify that sourceRevisionId is current immediately
 * before saving.
 */
export function assembleGrantHierarchicalExecutionForPersistenceV1(input: {
  documentId: string;
  actorId: string;
  checkerId: string;
  checkerVersion: string;
  snapshot: CanonicalGrantSnapshot;
  prepared: GrantHierarchicalDiagnosticPreparedInputV1;
  execution: HierarchicalExecutionResult;
  runId?: string;
  checkpointId?: string;
  startedAt: string;
  completedAt: string;
  createId?: () => string;
  previousFindings?: GrantNormalizedFinding[];
}): GrantHierarchicalDiagnosticExecutionV1 {
  const runId = input.runId ?? randomUUID();
  const inputHash = grantHierarchicalDiagnosticInputFingerprintV1(input.prepared);
  const findings = assembleGrantHierarchicalFindingsV1({
    runId,
    documentId: input.documentId,
    sourceRevisionId: input.prepared.sourceRevisionId,
    checkerId: input.checkerId,
    checkerVersion: input.checkerVersion,
    snapshot: input.snapshot,
    result: input.execution.rootDiagnosis,
    createId: input.createId,
    now: () => input.completedAt,
  });
  const checkpoint = createGrantArgumentMapCheckpointV1({
    documentId: input.documentId,
    checkerId: input.checkerId,
    checkerVersion: input.checkerVersion,
    prepared: input.prepared,
    argumentMap: input.execution.argumentMap,
    status: "consumed",
    checkpointId: input.checkpointId,
    now: () => input.completedAt,
  });
  const run = GrantDiagnosticRunSchema.parse({
    runId,
    documentId: input.documentId,
    sourceRevisionId: input.prepared.sourceRevisionId,
    checkerId: input.checkerId,
    checkerVersion: input.checkerVersion,
    contractVersion: input.prepared.argumentMapRequest.contractVersion,
    inputMode: input.prepared.argumentMapRequest.inputMode,
    inputNodeIds: [...input.prepared.locationRefByNodeId.keys()],
    inputHash,
    status: "succeeded",
    parsedOutput: {
      findingCount: findings.length,
      stableFindingKeys: findings.map((finding) => finding.rootFingerprint),
      stableFindingSubjects: findings.map((finding) => ({
        key: finding.rootFingerprint,
        sectionId: finding.sourceAnchor.sectionId,
      })),
      inputSectionIds: [...new Set(input.prepared.sectionIdByNodeId.values())],
      metadata: {
        hierarchical: true,
        providerCallCount: input.execution.providerCallCount,
        usage: input.execution.usage,
        resumedFromArgumentMap: input.execution.resumedFromArgumentMap,
        imageCoverage: input.execution.imageCoverage,
        argumentMapCheckpointId: checkpoint.checkpointId,
      },
    },
    createdBy: input.actorId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });
  const continuityLinks = linkGrantHierarchicalContinuityV1({
    currentFindings: findings,
    previousFindings: input.previousFindings ?? [],
    targetRevisionId: input.prepared.sourceRevisionId,
    targetSnapshot: input.snapshot,
  });
  return { run, findings, argumentMapCheckpoint: checkpoint, continuityLinks };
}
