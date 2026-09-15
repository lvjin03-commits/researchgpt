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
  readonly category: "structured_output_invalid" | "output_truncated" | "content_filtered" | "provider_refusal" | "provider_rate_limited" | "provider_transient_error" | "provider_contract_error" | "provider_unavailable";

  readonly providerRequestId?: string;
  readonly usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };

  constructor(category: GrantAssistantModelError["category"], message: string, metadata?: {
    providerRequestId?: string;
    usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  }) {
    super(message);
    this.name = "GrantAssistantModelError";
    this.category = category;
    this.providerRequestId = metadata?.providerRequestId;
    this.usage = metadata?.usage;
  }
}

export interface GrantAssistantModel {
  answerChat(request: GrantAssistantChatModelRequest): Promise<GrantAssistantChatModelResult>;
}
