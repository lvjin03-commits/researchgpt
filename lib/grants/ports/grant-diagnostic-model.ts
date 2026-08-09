import type { GrantDiagnosticInputMode, GrantFindingAssessment } from "../diagnostics/contracts.ts";

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

export const GRANT_DIAGNOSTIC_POLICY_VERSION = "grant-ai-policy-v2";
export const GRANT_DIAGNOSTIC_SCHEMA_VERSION = "grant-semantic-diagnostic-v2";
export const GRANT_DIAGNOSTIC_PROMPT_VERSION = "grant-semantic-prompt-v2";

export type GrantDiagnosticFailureCategory =
  | "output_truncated"
  | "content_filtered"
  | "provider_refusal"
  | "structured_output_invalid"
  | "semantic_reference_invalid"
  | "provider_rate_limited"
  | "provider_transient_error"
  | "provider_contract_error"
  | "provider_unavailable"
  | "unknown_provider_failure";

export type GrantDiagnosticExecutionMetadata = {
  operation: "diagnostic.semantic";
  policyVersion: typeof GRANT_DIAGNOSTIC_POLICY_VERSION;
  schemaVersion: typeof GRANT_DIAGNOSTIC_SCHEMA_VERSION;
  promptVersion: typeof GRANT_DIAGNOSTIC_PROMPT_VERSION;
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
}
