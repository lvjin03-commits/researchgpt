import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantDiagnosticInputMode, GrantFindingAssessment } from "./contracts.ts";
import type { GrantSemanticDiagnosticResultV3, GrantSemanticDiagnosticV3ReferenceScope } from "./semantic-v3-contracts.ts";
import type { GrantSemanticDiagnosticV3PriorFinding } from "./semantic-v3-input.ts";
import type { GrantDiagnosticExecutionMetadata, GrantHierarchicalDiagnosticModelResult } from "../ports/grant-diagnostic-model.ts";
import type { GrantHierarchicalDiagnosticPreparedInputV1 } from "./hierarchical-semantic-input.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "./semantic-review-v6-input.ts";
import type { GrantSemanticReviewV6ModelResult } from "../ports/grant-diagnostic-model.ts";

export type GrantCheckerInput = {
  executionId: string;
  documentId: string;
  revisionId: string;
  snapshot: CanonicalGrantSnapshot;
  inputMode: GrantDiagnosticInputMode;
  inputNodeIds: string[];
  inputSectionIds: string[];
  fundingCategory: string;
  priorSemanticFindings: GrantSemanticDiagnosticV3PriorFinding[];
};

export type GrantCheckerFindingCandidate = {
  code: string;
  message: string;
  recommendation: string;
  assessment: GrantFindingAssessment;
  subjectKey: string;
  conclusion: string;
  sectionId?: string;
  nodeId?: string;
  startOffset?: number;
  endOffset?: number;
};

export type GrantCheckerOutput = {
  findings: GrantCheckerFindingCandidate[];
  metadata?: Record<string, unknown>;
  semanticV3?: {
    result: GrantSemanticDiagnosticResultV3;
    referenceScope: GrantSemanticDiagnosticV3ReferenceScope;
    execution: GrantDiagnosticExecutionMetadata;
    provider: "openai";
    modelId: string;
    usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  };
  semanticHierarchical?: {
    prepared: GrantHierarchicalDiagnosticPreparedInputV1;
    execution: GrantHierarchicalDiagnosticModelResult;
    checkpointId?: string;
  };
  semanticReviewV6?: {
    prepared: GrantSemanticReviewV6PreparedInputV1;
    execution: GrantSemanticReviewV6ModelResult;
    checkpointId?: string;
  };
};

export interface GrantChecker {
  readonly checkerId: string;
  readonly checkerVersion: string;
  readonly contractVersion: string;
  readonly inputMode: GrantDiagnosticInputMode;
  readonly supportedInputModes?: readonly GrantDiagnosticInputMode[];
  readonly configurationFingerprint?: string;
  check(input: GrantCheckerInput): Promise<GrantCheckerOutput>;
}
