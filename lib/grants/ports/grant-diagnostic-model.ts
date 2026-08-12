import type { GrantDiagnosticInputMode, GrantFindingAssessment } from "../diagnostics/contracts.ts";
import type { GrantSemanticDiagnosticResultV3 } from "../diagnostics/semantic-v3-contracts.ts";
import type { GrantSemanticDiagnosticV3PreparedInput } from "../diagnostics/semantic-v3-input.ts";
import type { GrantDiagnosticValidationIssue } from "../diagnostics/validation-telemetry.ts";
import type { GrantSemanticDiagnosticV3NormalizationAction } from "../diagnostics/semantic-v3-contracts.ts";
import type {
  GrantArgumentMapV1,
  GrantHierarchicalDiagnosticStageState,
  GrantRootDiagnosticResultV1,
} from "../diagnostics/hierarchical-semantic-contracts.ts";
import type { GrantHierarchicalDiagnosticPreparedInputV1 } from "../diagnostics/hierarchical-semantic-input.ts";
import type {
  GrantDiagnosticImageAdmissionProvider,
  GrantDiagnosticImageCoverage,
} from "../diagnostics/multimodal-diagnostic-input.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "../diagnostics/semantic-review-v6-input.ts";
import type {
  GrantSemanticReviewV6PortableCheckpoint,
  GrantSemanticReviewV6PortableExecutionResult,
} from "../diagnostics/semantic-review-v6-persistence.ts";

export type GrantDiagnosticModelNode = {
  nodeId: string;
  sectionId: string;
  nodeType: "heading" | "paragraph" | "list" | "table" | "figure" | "citation" | "formula";
  text: string;
};

export type GrantDiagnosticModelSection = {
  sectionId: string;
  semanticRole: string;
  title: string;
  parentSectionId?: string;
  nodes: GrantDiagnosticModelNode[];
};

export type GrantDiagnosticEvidenceExcerpt = {
  sourceId: string;
  cardId: string;
  sourceTitle: string;
  provenanceType: "published_literature" | "own_unpublished_work" | "project_material";
  excerpt: string;
};

export type GrantDiagnosticModelRequest = {
  documentLanguage: "zh" | "en";
  documentTitle: string;
  inputMode: GrantDiagnosticInputMode;
  sections: GrantDiagnosticModelSection[];
  evidence: GrantDiagnosticEvidenceExcerpt[];
};

export type GrantDiagnosticModelFinding = {
  category:
    | "scientific_question_gap"
    | "argument_chain_gap"
    | "innovation_gap"
    | "objective_method_mismatch"
    | "evidence_support_gap"
    | "cross_section_inconsistency";
  message: string;
  recommendation: string;
  assessment: GrantFindingAssessment;
  sectionId: string;
  nodeId: string;
};

export type GrantDiagnosticModelResult = {
  findings: GrantDiagnosticModelFinding[];
  provider: "openai";
  modelId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
  execution: GrantDiagnosticExecutionMetadata;
};

export type GrantSemanticDiagnosticV3ModelResult = GrantSemanticDiagnosticResultV3 & {
  provider: "openai";
  modelId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
  execution: GrantDiagnosticExecutionMetadata;
};

export type GrantHierarchicalDiagnosticModelResult = {
  argumentMap: GrantArgumentMapV1;
  rootDiagnosis: GrantRootDiagnosticResultV1;
  stages: GrantHierarchicalDiagnosticStageState[];
  providerCallCount: number;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  resumedFromArgumentMap: boolean;
  provider: "openai";
  modelId: string;
  imageCoverage: GrantDiagnosticImageCoverage;
};

export class GrantHierarchicalDiagnosticModelError extends Error {
  readonly failureCode: string;
  readonly stages: GrantHierarchicalDiagnosticStageState[];
  readonly providerCallCount: number;
  readonly usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  readonly argumentMapCheckpoint?: GrantArgumentMapV1;
  readonly imageCoverage: GrantDiagnosticImageCoverage;

  constructor(input: {
    failureCode: string;
    message: string;
    stages: GrantHierarchicalDiagnosticStageState[];
    providerCallCount: number;
    usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
    argumentMapCheckpoint?: GrantArgumentMapV1;
    imageCoverage: GrantDiagnosticImageCoverage;
  }) {
    super(input.message);
    this.name = "GrantHierarchicalDiagnosticModelError";
    this.failureCode = input.failureCode;
    this.stages = input.stages;
    this.providerCallCount = input.providerCallCount;
    this.usage = input.usage;
    this.argumentMapCheckpoint = input.argumentMapCheckpoint;
    this.imageCoverage = input.imageCoverage;
  }
}

export type GrantSemanticReviewV6ModelResult = GrantSemanticReviewV6PortableExecutionResult & {
  provider: "openai";
  modelId: string;
};

export class GrantSemanticReviewV6ModelError extends Error {
  readonly failureCode: string;
  readonly failedStage: string;
  readonly providerCallCount: number;
  readonly completionTokenAllocation: number;
  readonly usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  readonly stages: GrantSemanticReviewV6PortableExecutionResult["stages"];
  readonly checkpoint?: GrantSemanticReviewV6PortableCheckpoint;
  readonly imageCoverage: GrantDiagnosticImageCoverage;

  constructor(input: {
    failureCode: string;
    failedStage: string;
    message: string;
    providerCallCount: number;
    completionTokenAllocation: number;
    usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
    stages: GrantSemanticReviewV6PortableExecutionResult["stages"];
    checkpoint?: GrantSemanticReviewV6PortableCheckpoint;
    imageCoverage: GrantDiagnosticImageCoverage;
  }) {
    super(input.message);
    this.name = "GrantSemanticReviewV6ModelError";
    this.failureCode = input.failureCode;
    this.failedStage = input.failedStage;
    this.providerCallCount = input.providerCallCount;
    this.completionTokenAllocation = input.completionTokenAllocation;
    this.usage = input.usage;
    this.stages = input.stages;
    this.checkpoint = input.checkpoint;
    this.imageCoverage = input.imageCoverage;
  }
}

export const GRANT_DIAGNOSTIC_POLICY_VERSION = "grant-ai-policy-v2";
export const GRANT_DIAGNOSTIC_SCHEMA_VERSION = "grant-semantic-diagnostic-v2";
export const GRANT_DIAGNOSTIC_PROMPT_VERSION = "grant-semantic-prompt-v2";
export const GRANT_DIAGNOSTIC_V3_POLICY_VERSION = "grant-ai-policy-v3.2";
export const GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION = "grant-semantic-diagnostic-v4";
export const GRANT_DIAGNOSTIC_V3_PROMPT_VERSION = "grant-semantic-review-v4";
/**
 * Durable run contract accepted by save_grant_semantic_v3_execution.
 * The V3 model-output schema and durable run contract intentionally advance
 * together; the prompt version remains an independent concern.
 */
export const GRANT_DIAGNOSTIC_V3_CONTRACT_VERSION = GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION;

export type GrantDiagnosticFailureCategory =
  | "output_truncated"
  | "content_filtered"
  | "provider_refusal"
  | "structured_output_invalid"
  | "structured_reference_invalid"
  | "semantic_reference_invalid"
  | "provider_rate_limited"
  | "provider_transient_error"
  | "provider_contract_error"
  | "provider_unavailable"
  | "unknown_provider_failure";

export type GrantDiagnosticExecutionMetadata = {
  operation: "diagnostic.semantic";
  policyVersion: typeof GRANT_DIAGNOSTIC_POLICY_VERSION | typeof GRANT_DIAGNOSTIC_V3_POLICY_VERSION;
  schemaVersion: typeof GRANT_DIAGNOSTIC_SCHEMA_VERSION | typeof GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION;
  promptVersion: typeof GRANT_DIAGNOSTIC_PROMPT_VERSION | typeof GRANT_DIAGNOSTIC_V3_PROMPT_VERSION;
  provider: "openai";
  modelId: string;
  providerRequestId?: string;
  finishReason?: string;
  refusal?: string;
  attemptCount: number;
  attemptPurpose: "initial" | "capacity_retry" | "schema_repair" | "transient_retry";
  recoveredFrom?: GrantDiagnosticFailureCategory;
  responseHash?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  zodIssuePaths?: string[];
  validationIssues?: GrantDiagnosticValidationIssue[];
  normalizationActions?: GrantSemanticDiagnosticV3NormalizationAction[];
};

export class GrantDiagnosticExecutionError extends Error {
  readonly category: GrantDiagnosticFailureCategory;
  readonly metadata: GrantDiagnosticExecutionMetadata;

  constructor(category: GrantDiagnosticFailureCategory, message: string, metadata: GrantDiagnosticExecutionMetadata) {
    super(message);
    this.name = "GrantDiagnosticExecutionError";
    this.category = category;
    this.metadata = metadata;
  }
}

export interface GrantDiagnosticModel {
  diagnose(request: GrantDiagnosticModelRequest): Promise<GrantDiagnosticModelResult>;
  diagnoseV3?(prepared: GrantSemanticDiagnosticV3PreparedInput): Promise<GrantSemanticDiagnosticV3ModelResult>;
  diagnoseHierarchical?(
    prepared: GrantHierarchicalDiagnosticPreparedInputV1,
    argumentMapCheckpoint?: GrantArgumentMapV1,
    imageAdmission?: GrantDiagnosticImageAdmissionProvider,
  ): Promise<GrantHierarchicalDiagnosticModelResult>;
  diagnoseSemanticReviewV6?(
    prepared: GrantSemanticReviewV6PreparedInputV1,
    checkpoint?: GrantSemanticReviewV6PortableCheckpoint,
    imageAdmission?: GrantDiagnosticImageAdmissionProvider,
  ): Promise<GrantSemanticReviewV6ModelResult>;
}
