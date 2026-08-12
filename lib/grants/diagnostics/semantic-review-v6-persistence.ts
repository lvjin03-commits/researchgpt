import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantSemanticReviewV6Execution } from "../ports/grant-diagnostic-repository.ts";
import { createGrantSourceAnchor } from "./anchors.ts";
import { GrantDiagnosticRunSchema, GrantFindingSchema } from "./contracts.ts";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  GrantFactMapCoverageReportV1Schema,
  GrantFactMapV1Schema,
  GrantNarrativeFindingContentV1Schema,
  GrantScientificFindingContentV1Schema,
} from "./semantic-review-v6-contracts.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "./semantic-review-v6-input.ts";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoTimestampSchema = z.string().datetime({ offset: true });

export const GrantSemanticReviewV6CheckpointRecordSchema = z.object({
  checkpointId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  checkerId: z.string().trim().min(1),
  checkerVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.checkerVersion),
  contractVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion),
  inputFingerprint: Sha256Schema,
  locationScopeFingerprint: Sha256Schema,
  matureStage: z.enum(["fact_map", "scientific_review"]),
  factMap: GrantFactMapV1Schema,
  scientificReview: z.object({
    scientificFindings: z.array(GrantScientificFindingContentV1Schema).max(16),
    coverageReport: GrantFactMapCoverageReportV1Schema,
  }).strict().nullable(),
  status: z.enum(["ready", "consumed", "superseded"]),
  createdAt: IsoTimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.factMap.sourceRevisionId !== value.sourceRevisionId
    || value.factMap.locationScopeFingerprint !== value.locationScopeFingerprint) {
    context.addIssue({ code: "custom", path: ["factMap"], message: "Checkpoint Fact Map crossed its frozen scope." });
  }
  if ((value.matureStage === "scientific_review") !== (value.scientificReview !== null)) {
    context.addIssue({ code: "custom", path: ["scientificReview"], message: "Checkpoint stage and payload must agree." });
  }
  if (value.scientificReview
    && value.scientificReview.coverageReport.sourceRevisionId !== value.sourceRevisionId) {
    context.addIssue({ code: "custom", path: ["scientificReview", "coverageReport"], message: "Checkpoint coverage crossed revisions." });
  }
});

export const GrantSemanticReviewV6FindingDetailSchema = z.discriminatedUnion("family", [
  z.object({
    findingId: UuidSchema,
    family: z.literal("scientific"),
    schemaVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.scientificFindingSchemaVersion),
    policyVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.policyVersion),
    contractVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion),
    displayOrder: z.number().int().nonnegative(),
    content: GrantScientificFindingContentV1Schema,
  }).strict(),
  z.object({
    findingId: UuidSchema,
    family: z.literal("narrative"),
    schemaVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.narrativeFindingSchemaVersion),
    policyVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.policyVersion),
    contractVersion: z.literal(GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion),
    displayOrder: z.number().int().nonnegative(),
    content: GrantNarrativeFindingContentV1Schema,
  }).strict(),
]);

export type GrantSemanticReviewV6CheckpointRecord = z.infer<typeof GrantSemanticReviewV6CheckpointRecordSchema>;
export type GrantSemanticReviewV6FindingDetail = z.infer<typeof GrantSemanticReviewV6FindingDetailSchema>;
export type GrantSemanticReviewV6PortableCheckpoint = {
  sourceRevisionId: string;
  inputFingerprint: string;
  locationScopeFingerprint: string;
  factMap: z.infer<typeof GrantFactMapV1Schema>;
  scientificReview?: {
    scientificFindings: z.infer<typeof GrantScientificFindingContentV1Schema>[];
    coverageReport: z.infer<typeof GrantFactMapCoverageReportV1Schema>;
  };
};
export type GrantSemanticReviewV6PortableExecutionResult = {
  factMap: z.infer<typeof GrantFactMapV1Schema>;
  scientificFindings: z.infer<typeof GrantScientificFindingContentV1Schema>[];
  coverageReport: z.infer<typeof GrantFactMapCoverageReportV1Schema>;
  narrativeFindings: z.infer<typeof GrantNarrativeFindingContentV1Schema>[];
  imageCoverage: unknown;
  providerCallCount: number;
  completionTokenAllocation: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  stages: Array<{ stage: string; status: string; attemptCount: number; failureCode: string | null }>;
  resumedFrom: string;
};

export function createGrantSemanticReviewV6Checkpoint(input: {
  documentId: string;
  checkerId: string;
  prepared: GrantSemanticReviewV6PreparedInputV1;
  checkpoint: GrantSemanticReviewV6PortableCheckpoint;
  status?: GrantSemanticReviewV6CheckpointRecord["status"];
  checkpointId?: string;
  now?: () => string;
}): GrantSemanticReviewV6CheckpointRecord {
  return GrantSemanticReviewV6CheckpointRecordSchema.parse({
    checkpointId: input.checkpointId ?? randomUUID(),
    documentId: input.documentId,
    sourceRevisionId: input.prepared.sourceRevisionId,
    checkerId: input.checkerId,
    checkerVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.checkerVersion,
    contractVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
    inputFingerprint: input.prepared.inputFingerprint,
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    matureStage: input.checkpoint.scientificReview ? "scientific_review" : "fact_map",
    factMap: input.checkpoint.factMap,
    scientificReview: input.checkpoint.scientificReview ?? null,
    status: input.status ?? "ready",
    createdAt: (input.now ?? (() => new Date().toISOString()))(),
  });
}

export function toGrantSemanticReviewV6ExecutionCheckpoint(
  checkpoint: GrantSemanticReviewV6CheckpointRecord,
): GrantSemanticReviewV6PortableCheckpoint {
  const parsed = GrantSemanticReviewV6CheckpointRecordSchema.parse(checkpoint);
  return {
    sourceRevisionId: parsed.sourceRevisionId,
    inputFingerprint: parsed.inputFingerprint,
    locationScopeFingerprint: parsed.locationScopeFingerprint,
    factMap: parsed.factMap,
    scientificReview: parsed.scientificReview ?? undefined,
  };
}

function stableScientificIdentity(input: {
  finding: z.infer<typeof GrantScientificFindingContentV1Schema>;
  factMap: z.infer<typeof GrantFactMapV1Schema>;
}) {
  const semanticByRef = new Map(input.factMap.semanticObjects.map((item) => [item.semanticObjectRef, item]));
  return input.finding.semanticObjectRefs.map((ref) => {
    const item = semanticByRef.get(ref)!;
    return {
      objectType: item.objectType,
      normalizedFacet: item.normalizedFacet,
      anchors: item.anchors.map((anchor) => ({ nodeId: anchor.nodeId, anchorHash: anchor.anchorHash })),
    };
  });
}

/** Builds one atomic repository payload. Model prose is persisted as approved
 * diagnostic content, but never participates in durable Finding identity. */
export function assembleGrantSemanticReviewV6ExecutionForPersistence(input: {
  documentId: string;
  actorId: string;
  checkerId: string;
  snapshot: CanonicalGrantSnapshot;
  prepared: GrantSemanticReviewV6PreparedInputV1;
  execution: GrantSemanticReviewV6PortableExecutionResult;
  runId?: string;
  checkpointId?: string;
  startedAt: string;
  completedAt: string;
  createId?: () => string;
}): GrantSemanticReviewV6Execution {
  const runId = input.runId ?? randomUUID();
  const createId = input.createId ?? randomUUID;
  const allContents: Array<
    | { family: "scientific"; content: z.infer<typeof GrantScientificFindingContentV1Schema> }
    | { family: "narrative"; content: z.infer<typeof GrantNarrativeFindingContentV1Schema> }
  > = [
    ...input.execution.scientificFindings.map((content) => ({ family: "scientific" as const, content })),
    ...input.execution.narrativeFindings.map((content) => ({ family: "narrative" as const, content })),
  ];
  const seenFingerprints = new Set<string>();
  const findings = allContents.map((entry, displayOrder) => {
    let fingerprint: string;
    let message: string;
    let recommendation: string;
    if (entry.family === "scientific") {
      fingerprint = sha256Canonical({
        checkerId: input.checkerId,
        checkerVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.checkerVersion,
        family: entry.family,
        category: entry.content.category,
        primaryLocation: entry.content.primaryLocation,
        relatedLocations: entry.content.relatedLocations,
        semanticObjects: stableScientificIdentity({ finding: entry.content, factMap: input.execution.factMap }),
      });
      message = entry.content.diagnosticFact;
      recommendation = entry.content.recommendation;
    } else {
      fingerprint = sha256Canonical({
        checkerId: input.checkerId,
        checkerVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.checkerVersion,
        family: entry.family,
        category: entry.content.category,
        affectedScope: entry.content.affectedScope,
        primaryLocation: entry.content.primaryLocation,
        relatedLocations: entry.content.relatedLocations,
        usedFigureAssetIds: entry.content.usedFigureAssetIds,
      });
      message = entry.content.observedPresentation;
      recommendation = entry.content.suggestedOrganization;
    }
    if (seenFingerprints.has(fingerprint)) throw new Error("V6 execution contains structurally duplicate Findings.");
    seenFingerprints.add(fingerprint);
    const findingId = createId();
    const content = entry.content;
    return {
      envelope: GrantFindingSchema.parse({
        findingId, runId, documentId: input.documentId,
        sourceRevisionId: input.prepared.sourceRevisionId,
        checkerId: input.checkerId,
        checkerVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.checkerVersion,
        fingerprint, code: content.category, message, recommendation,
        assessment: content.assessment,
        sourceAnchor: createGrantSourceAnchor({
          snapshot: input.snapshot,
          sourceRevisionId: input.prepared.sourceRevisionId,
          sectionId: content.primaryLocation.sectionId,
          nodeId: content.primaryLocation.nodeId,
        }),
        lifecycleStatus: "open", createdAt: input.completedAt,
      }),
      detail: GrantSemanticReviewV6FindingDetailSchema.parse({
        findingId, family: entry.family,
        schemaVersion: entry.family === "scientific"
          ? GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.scientificFindingSchemaVersion
          : GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.narrativeFindingSchemaVersion,
        policyVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.policyVersion,
        contractVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
        displayOrder, content,
      }),
    };
  });
  const checkpoint = createGrantSemanticReviewV6Checkpoint({
    documentId: input.documentId,
    checkerId: input.checkerId,
    prepared: input.prepared,
    checkpoint: {
      sourceRevisionId: input.prepared.sourceRevisionId,
      inputFingerprint: input.prepared.inputFingerprint,
      locationScopeFingerprint: input.prepared.locationScopeFingerprint,
      factMap: input.execution.factMap,
      scientificReview: {
        scientificFindings: input.execution.scientificFindings,
        coverageReport: input.execution.coverageReport,
      },
    },
    checkpointId: input.checkpointId,
    status: "consumed",
    now: () => input.completedAt,
  });
  const run = GrantDiagnosticRunSchema.parse({
    runId, documentId: input.documentId,
    sourceRevisionId: input.prepared.sourceRevisionId,
    checkerId: input.checkerId,
    checkerVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.checkerVersion,
    contractVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion,
    inputMode: input.prepared.reviewBaseRequest.inputMode,
    inputNodeIds: [...input.prepared.locationRefByNodeId.keys()],
    inputHash: input.prepared.inputFingerprint,
    status: "succeeded",
    parsedOutput: {
      findingCount: findings.length,
      scientificFindingCount: input.execution.scientificFindings.length,
      narrativeFindingCount: input.execution.narrativeFindings.length,
      providerCallCount: input.execution.providerCallCount,
      completionTokenAllocation: input.execution.completionTokenAllocation,
      usage: input.execution.usage,
      stages: input.execution.stages,
      resumedFrom: input.execution.resumedFrom,
      imageCoverage: input.execution.imageCoverage,
      factMapCheckpointId: checkpoint.checkpointId,
    },
    createdBy: input.actorId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });
  return { run, findings: findings.map((item) => item.envelope), findingDetails: findings.map((item) => item.detail), checkpoint };
}
