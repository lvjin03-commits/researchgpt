import type { GrantAssistantAnswerMode, GrantAssistantDiagnosticScopeProposal,
  GrantAssistantDocumentScopeProposal, GrantAssistantMemoryScopeProposal,
  GrantAssistantWebRecommendation } from "../assistant/context-plan-contracts.ts";

export type GrantAssistantContextPlanProposal = {
  answerMode: GrantAssistantAnswerMode;
  memoryScope: GrantAssistantMemoryScopeProposal;
  documentScope: GrantAssistantDocumentScopeProposal;
  diagnosticScope: GrantAssistantDiagnosticScopeProposal;
  webRecommendation: GrantAssistantWebRecommendation;
  needsClarification: boolean;
  clarificationQuestion?: string;
  confidence: number;
  rationale: string;
  provider?: "openai";
  modelId?: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
};

export type GrantAssistantContextPlanModelRequest = {
  documentLanguage: "zh" | "en";
  question: string;
  recentConversation: Array<{ role: "user" | "assistant"; content: string }>;
  documentMemoryText: string;
  allowedSectionAliases: string[];
  allowedMemoryItemAliases: string[];
  explicitContext: {
    hasDocumentSelection: boolean;
    hasCandidate: boolean;
    hasEvidence: boolean;
    webSearchEnabledByUser: boolean;
  };
  maximumOutputTokens: number;
  attemptPurpose?: "initial" | "schema_repair" | "capacity_retry" | "transient_retry";
};

export interface GrantAssistantContextPlannerModel {
  plan(input: GrantAssistantContextPlanModelRequest): Promise<GrantAssistantContextPlanProposal>;
}
