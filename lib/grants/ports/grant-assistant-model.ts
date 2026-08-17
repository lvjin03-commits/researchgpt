export type GrantAssistantChatMessage = { role: "user" | "assistant"; content: string };

export type GrantAssistantAdmittedContext = {
  sourceAlias: string;
  sourceType: "document_selection" | "evidence" | "academic_source";
  label: string;
  excerpt: string;
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

  constructor(category: GrantAssistantModelError["category"], message: string) {
    super(message);
    this.name = "GrantAssistantModelError";
    this.category = category;
  }
}

export interface GrantAssistantModel {
  answerChat(request: GrantAssistantChatModelRequest): Promise<GrantAssistantChatModelResult>;
}
