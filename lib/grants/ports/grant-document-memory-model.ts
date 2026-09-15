import type { GrantDocumentMemoryItemKind } from "../assistant/document-memory-contracts.ts";

export type GrantDocumentMemorySemanticItemProposal = {
  kind: GrantDocumentMemoryItemKind;
  statement: string;
  concepts: string[];
  sourceAliases: string[];
};

export type GrantDocumentMemorySectionProposal = {
  sectionAlias: string;
  summary: string;
  sourceAliases: string[];
};

export type GrantDocumentMemoryModelMetadata = {
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  provider?: "openai";
  modelId?: string;
};

export type GrantDocumentMemoryUnitAnalysis = GrantDocumentMemoryModelMetadata & {
  summary: string;
  sectionSummaries: GrantDocumentMemorySectionProposal[];
  semanticItems: GrantDocumentMemorySemanticItemProposal[];
};

export interface GrantDocumentMemoryModel {
  analyzeMemoryUnit(input: {
    documentLanguage: "zh" | "en";
    contextHash: string;
    unitId: string;
    modelText: string;
    allowedSectionAliases: string[];
    allowedSourceAliases: string[];
    attemptPurpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry";
    maximumOutputTokens: number;
  }): Promise<GrantDocumentMemoryUnitAnalysis>;
}
