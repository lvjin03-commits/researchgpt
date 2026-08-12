import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantChecker, GrantCheckerFindingCandidate, GrantCheckerInput } from "../diagnostics/checker.ts";
import {
  GRANT_DIAGNOSTIC_POLICY_VERSION,
  GRANT_DIAGNOSTIC_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_SCHEMA_VERSION,
  GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION,
  GRANT_DIAGNOSTIC_V3_POLICY_VERSION,
  GRANT_DIAGNOSTIC_V3_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION,
} from "../ports/grant-diagnostic-model.ts";
import { GrantModelDataGateway } from "./grant-model-data-gateway.ts";
import type { GrantDiagnosticRepository } from "../ports/grant-diagnostic-repository.ts";
import {
  createGrantArgumentMapCheckpointV1,
  grantHierarchicalDiagnosticInputFingerprintV1,
} from "../diagnostics/hierarchical-diagnostic-persistence.ts";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  type GrantArgumentMapCheckpointV1,
} from "../diagnostics/hierarchical-semantic-contracts.ts";
import { GrantHierarchicalDiagnosticModelError, GrantSemanticReviewV6ModelError } from "../ports/grant-diagnostic-model.ts";
import { GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS } from "../diagnostics/semantic-review-v6-contracts.ts";
import {
  createGrantSemanticReviewV6Checkpoint,
  toGrantSemanticReviewV6ExecutionCheckpoint,
  type GrantSemanticReviewV6CheckpointRecord,
} from "../diagnostics/semantic-review-v6-persistence.ts";

export const GRANT_SEMANTIC_DIAGNOSTIC_CHECKER_ID = "grant-semantic-argument-diagnostic";

export class GrantHierarchicalSemanticCheckerError extends Error {
  readonly modelError: GrantHierarchicalDiagnosticModelError;
  readonly checkpoint?: GrantArgumentMapCheckpointV1;

  constructor(modelError: GrantHierarchicalDiagnosticModelError, checkpoint?: GrantArgumentMapCheckpointV1) {
    super(modelError.message);
    this.name = "GrantHierarchicalSemanticCheckerError";
    this.modelError = modelError;
    this.checkpoint = checkpoint;
  }
}

export class GrantSemanticReviewV6CheckerError extends Error {
  readonly modelError: GrantSemanticReviewV6ModelError;
  readonly checkpoint?: GrantSemanticReviewV6CheckpointRecord;

  constructor(modelError: GrantSemanticReviewV6ModelError, checkpoint?: GrantSemanticReviewV6CheckpointRecord) {
    super(modelError.message);
    this.name = "GrantSemanticReviewV6CheckerError";
    this.modelError = modelError;
    this.checkpoint = checkpoint;
  }
}

export class GrantSemanticDiagnosticChecker implements GrantChecker {
  readonly checkerId = GRANT_SEMANTIC_DIAGNOSTIC_CHECKER_ID;
  readonly checkerVersion: string;
  readonly contractVersion: string;
  readonly inputMode = "full_document" as const;
  readonly supportedInputModes = ["full_document", "section_bundle"] as const;
  readonly configurationFingerprint: string;
  private readonly gateway: GrantModelDataGateway;
  private readonly repository?: GrantDiagnosticRepository;

  private readonly version: "v2" | "v3" | "hierarchical" | "v6";

  constructor(
    gateway: GrantModelDataGateway,
    modelId: string,
    version: "v2" | "v3" | "hierarchical" | "v6" = "v2",
    repository?: GrantDiagnosticRepository,
  ) {
    this.gateway = gateway;
    this.version = version;
    this.repository = repository;
    this.checkerVersion = version === "v6"
      ? GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.checkerVersion
      : version === "hierarchical"
      ? GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.checkerVersion
      : version === "v3" ? "4.0.0" : "2.0.0";
    this.contractVersion = version === "v6"
      ? GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerContractVersion
      : version === "hierarchical"
      ? GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion
      : version === "v3" ? GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION : GRANT_DIAGNOSTIC_SCHEMA_VERSION;
    this.configurationFingerprint = sha256Canonical({
      provider: "openai",
      modelId,
      promptVersion: version === "v6"
        ? GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.promptVersion
        : version === "hierarchical"
        ? GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.promptVersion
        : version === "v3" ? GRANT_DIAGNOSTIC_V3_PROMPT_VERSION : GRANT_DIAGNOSTIC_PROMPT_VERSION,
      policyVersion: version === "v6"
        ? GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.policyVersion
        : version === "hierarchical"
        ? GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.policyVersion
        : version === "v3" ? GRANT_DIAGNOSTIC_V3_POLICY_VERSION : GRANT_DIAGNOSTIC_POLICY_VERSION,
      schemaVersion: version === "v6"
        ? GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.providerSchemaVersion
        : version === "hierarchical"
        ? GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.durableFindingSchemaVersion
        : version === "v3" ? GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION : GRANT_DIAGNOSTIC_SCHEMA_VERSION,
    });
  }

  async check(input: GrantCheckerInput) {
    if (this.version === "v6") {
      const prepared = await this.gateway.prepareDiagnosticSemanticReviewV6Input({
        documentId: input.documentId,
        taskId: input.executionId,
        snapshot: input.snapshot,
        inputMode: input.inputMode,
        inputSectionIds: input.inputSectionIds,
        inputNodeIds: input.inputNodeIds,
        fundingCategory: input.fundingCategory,
        priorFindings: input.priorSemanticFindings,
        sourceRevisionId: input.revisionId,
      });
      const checkpoint = this.repository?.findSemanticReviewV6Checkpoint
        ? await this.repository.findSemanticReviewV6Checkpoint({
          documentId: input.documentId,
          sourceRevisionId: input.revisionId,
          checkerId: this.checkerId,
          checkerVersion: this.checkerVersion,
          inputFingerprint: prepared.inputFingerprint,
          locationScopeFingerprint: prepared.locationScopeFingerprint,
        })
        : null;
      try {
        const generated = await this.gateway.executeDiagnosticSemanticReviewV6Input(
          input.documentId,
          prepared,
          checkpoint ? toGrantSemanticReviewV6ExecutionCheckpoint(checkpoint) : undefined,
        );
        return {
          findings: [],
          metadata: {
            provider: generated.provider,
            modelId: generated.modelId,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
            reasoningTokens: generated.usage.reasoningTokens,
            providerCallCount: generated.providerCallCount,
            resumedFrom: generated.resumedFrom,
            imageCoverage: generated.imageCoverage,
          },
          semanticReviewV6: {
            prepared,
            execution: generated,
            checkpointId: checkpoint?.checkpointId,
          },
        };
      } catch (error) {
        if (!(error instanceof GrantSemanticReviewV6ModelError)) throw error;
        const readyCheckpoint = error.checkpoint
          ? createGrantSemanticReviewV6Checkpoint({
            documentId: input.documentId,
            checkerId: this.checkerId,
            prepared,
            checkpoint: error.checkpoint,
          })
          : undefined;
        throw new GrantSemanticReviewV6CheckerError(error, readyCheckpoint);
      }
    }
    if (this.version === "hierarchical") {
      const prepared = await this.gateway.prepareDiagnosticHierarchicalInput({
        documentId: input.documentId,
        taskId: input.executionId,
        snapshot: input.snapshot,
        inputMode: input.inputMode,
        inputSectionIds: input.inputSectionIds,
        inputNodeIds: input.inputNodeIds,
        fundingCategory: input.fundingCategory,
        priorFindings: input.priorSemanticFindings,
        sourceRevisionId: input.revisionId,
      });
      const inputFingerprint = grantHierarchicalDiagnosticInputFingerprintV1(prepared);
      const checkpoint = this.repository?.findArgumentMapCheckpoint
        ? await this.repository.findArgumentMapCheckpoint({
          documentId: input.documentId,
          sourceRevisionId: input.revisionId,
          checkerId: this.checkerId,
          checkerVersion: this.checkerVersion,
          inputFingerprint,
          locationScopeFingerprint: prepared.locationScopeFingerprint,
        })
        : undefined;
      try {
        const generated = await this.gateway.executeDiagnosticHierarchicalInput(
          input.documentId,
          prepared,
          checkpoint?.argumentMap,
        );
        return {
          findings: [],
          metadata: {
            provider: generated.provider,
            modelId: generated.modelId,
            inputTokens: generated.usage.inputTokens,
            outputTokens: generated.usage.outputTokens,
            reasoningTokens: generated.usage.reasoningTokens,
            providerCallCount: generated.providerCallCount,
            resumedFromArgumentMap: generated.resumedFromArgumentMap,
            imageCoverage: generated.imageCoverage,
          },
          semanticHierarchical: {
            prepared,
            execution: generated,
            checkpointId: checkpoint?.checkpointId,
          },
        };
      } catch (error) {
        if (!(error instanceof GrantHierarchicalDiagnosticModelError)) throw error;
        const readyCheckpoint = error.argumentMapCheckpoint
          ? createGrantArgumentMapCheckpointV1({
            documentId: input.documentId,
            checkerId: this.checkerId,
            checkerVersion: this.checkerVersion,
            prepared,
            argumentMap: error.argumentMapCheckpoint,
          })
          : undefined;
        throw new GrantHierarchicalSemanticCheckerError(error, readyCheckpoint);
      }
    }
    if (this.version === "v3") {
      const { generated, prepared } = await this.gateway.diagnoseV3({
        documentId: input.documentId,
        taskId: input.executionId,
        snapshot: input.snapshot,
        inputMode: input.inputMode,
        inputSectionIds: input.inputSectionIds,
        inputNodeIds: input.inputNodeIds,
        fundingCategory: input.fundingCategory,
        priorFindings: input.priorSemanticFindings,
      });
      return {
        findings: [],
        metadata: {
          provider: generated.provider,
          modelId: generated.modelId,
          inputTokens: generated.usage.inputTokens,
          outputTokens: generated.usage.outputTokens,
          reasoningTokens: generated.usage.reasoningTokens,
          execution: generated.execution,
          authorizedEvidenceCardCount: prepared.allowedEvidenceCardIds.size,
        },
        semanticV3: {
          result: { findings: generated.findings },
          referenceScope: {
            sectionIdByNodeId: prepared.sectionIdByNodeId,
            allowedEvidenceCardIds: prepared.allowedEvidenceCardIds,
          },
          execution: generated.execution,
          provider: generated.provider,
          modelId: generated.modelId,
          usage: generated.usage,
        },
      };
    }
    const output = await this.gateway.diagnose({
      documentId: input.documentId,
      taskId: input.executionId,
      snapshot: input.snapshot,
      inputMode: input.inputMode,
      inputSectionIds: input.inputSectionIds,
      inputNodeIds: input.inputNodeIds,
    });
    const findings = output.findings.map((finding): GrantCheckerFindingCandidate => ({
      code: finding.category,
      message: finding.message,
      recommendation: finding.recommendation,
      assessment: finding.assessment,
      subjectKey: `semantic:${finding.category}:${finding.sectionId}:${finding.nodeId}`,
      conclusion: "issue_present",
      sectionId: finding.sectionId,
      nodeId: finding.nodeId,
    }));
    return {
      findings: [...new Map(findings.map((finding) => [finding.subjectKey, finding])).values()],
      metadata: {
        provider: output.provider,
        modelId: output.modelId,
        inputTokens: output.usage.inputTokens,
        outputTokens: output.usage.outputTokens,
        reasoningTokens: output.usage.reasoningTokens,
        execution: output.execution,
        authorizedEvidenceCardCount: output.authorizedEvidenceCardIds.length,
      },
    };
  }
}
