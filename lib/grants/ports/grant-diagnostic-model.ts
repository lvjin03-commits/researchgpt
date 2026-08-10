import type { GrantDiagnosticInputMode, GrantFindingAssessment } from "../diagnostics/contracts.ts";
import type { GrantSemanticDiagnosticResultV3 } from "../diagnostics/semantic-v3-contracts.ts";
import type { GrantSemanticDiagnosticV3PreparedInput } from "../diagnostics/semantic-v3-input.ts";
import type { GrantDiagnosticValidationIssue } from "../diagnostics/validation-telemetry.ts";
import type { GrantSemanticDiagnosticV3NormalizationAction } from "../diagnostics/semantic-v3-contracts.ts";

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

export const GRANT_DIAGNOSTIC_POLICY_VERSION = "grant-ai-policy-v2";
export const GRANT_DIAGNOSTIC_SCHEMA_VERSION = "grant-semantic-diagnostic-v2";
export const GRANT_DIAGNOSTIC_PROMPT_VERSION = "grant-semantic-prompt-v2";
export const GRANT_DIAGNOSTIC_V3_POLICY_VERSION = "grant-ai-policy-v3.1";
export const GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION = "grant-semantic-diagnostic-v3";
export const GRANT_DIAGNOSTIC_V3_PROMPT_VERSION = "grant-semantic-review-v3";
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
}
