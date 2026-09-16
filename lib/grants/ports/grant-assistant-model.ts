import type { GrantAssistantFailureReason } from "../model-execution/assistant-failure-reasons.ts";

export type GrantAssistantChatMessage = { role: "user" | "assistant"; content: string };

export type GrantAssistantAdmittedContext = {
  sourceAlias: string;
  sourceType: "document_selection" | "document_memory" | "original_text" | "diagnostic" | "edit_candidate" | "evidence" | "academic_source" | "web_source";
  label: string;
  excerpt: string;
  /** Program-owned public URL. Present only for externally navigable sources. */
  url?: string;
};

export type GrantAssistantGroundedClaim = {
  claimId: string;
  statement: string;
  citationIds: string[];
};

export type GrantAssistantGroundedCitation = {
  citationId: string;
  sourceAlias: string;
  excerpt?: string;
};

export type GrantAssistantChatModelRequest = {
  documentLanguage: "zh" | "en";
  messages: GrantAssistantChatMessage[];
  admittedContext: GrantAssistantAdmittedContext[];
  contextPlan?: {
    answerMode: "answer" | "explain" | "analyze" | "compare" | "review" | "revise_guidance";
    documentAccess: "memory_only" | "targeted_original" | "full_original";
    diagnosticAccess: "none" | "relevant" | "all";
    rationale: string;
  };
  attemptPurpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry";
  maximumOutputTokens: number;
};

export type GrantAssistantChatModelResult = {
  content: string;
  claims: GrantAssistantGroundedClaim[];
  citations: GrantAssistantGroundedCitation[];
  provider: "openai";
  modelId: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
};

export class GrantAssistantModelError extends Error {
  readonly category: "structured_output_invalid" | "output_truncated" | "content_filtered" | "provider_refusal" | "provider_rate_limited" | "provider_transient_error" | "provider_contract_error" | "provider_unavailable" |
    "planning_capacity_exceeded" | "answer_capacity_exceeded" | "internal_contract_error";

  readonly providerRequestId?: string;
  readonly providerRequestIds: string[];
  readonly usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  readonly failureStage?: "memory_build" | "semantic_planning" | "context_admission" |
    "original_retrieval" | "answer_generation" | "persistence";
  readonly requestDispatched: boolean;
  readonly usageKnown: boolean;
  readonly failureReason?: GrantAssistantFailureReason;

  constructor(category: GrantAssistantModelError["category"], message: string, metadata?: {
    providerRequestId?: string;
    providerRequestIds?: string[];
    usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
    failureStage?: GrantAssistantModelError["failureStage"];
    failureReason?: GrantAssistantFailureReason;
    requestDispatched?: boolean;
    usageKnown?: boolean;
  }) {
    super(message);
    this.name = "GrantAssistantModelError";
    this.category = category;
    this.providerRequestId = metadata?.providerRequestId;
    this.providerRequestIds = [...new Set([
      ...(metadata?.providerRequestIds ?? []),
      ...(metadata?.providerRequestId ? [metadata.providerRequestId] : []),
    ])];
    this.usage = metadata?.usage;
    this.failureStage = metadata?.failureStage;
    this.requestDispatched = metadata?.requestDispatched ?? this.providerRequestIds.length > 0;
    this.usageKnown = metadata?.usageKnown ?? metadata?.usage !== undefined;
    this.failureReason = metadata?.failureReason;
  }
}

export interface GrantAssistantModel {
  answerChat(request: GrantAssistantChatModelRequest): Promise<GrantAssistantChatModelResult>;
}
