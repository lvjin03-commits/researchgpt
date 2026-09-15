import type { GrantAssistantAnswerMode, GrantAssistantDiagnosticAccess,
  GrantAssistantDocumentAccess, GrantAssistantWebRecommendation } from "../assistant/context-plan-contracts.ts";

export type GrantAssistantContextPlanProposal = {
  answerMode: GrantAssistantAnswerMode;
  documentAccess: GrantAssistantDocumentAccess;
  diagnosticAccess: GrantAssistantDiagnosticAccess;
  webRecommendation: GrantAssistantWebRecommendation;
  targetSectionAliases: string[];
  targetMemoryItemAliases: string[];
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
};

export interface GrantAssistantContextPlannerModel {
  plan(input: GrantAssistantContextPlanModelRequest): Promise<GrantAssistantContextPlanProposal>;
}
