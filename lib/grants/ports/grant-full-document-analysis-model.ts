export type GrantFullDocumentAnalysisFinding = {
  statement: string;
  sourceAliases: string[];
};

export type GrantFullDocumentUnitAnalysis = {
  summary: string;
  findings: GrantFullDocumentAnalysisFinding[];
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  provider?: "openai";
  modelId?: string;
};

export type GrantFullDocumentAnalysisAnswer = {
  content: string;
  claims: GrantFullDocumentAnalysisFinding[];
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
  provider?: "openai";
  modelId?: string;
};

export interface GrantFullDocumentAnalysisModel {
  analyzeUnit(input: import("../assistant/grant-full-document-review-request.ts")
    .GrantFullDocumentUnitRequest): Promise<GrantFullDocumentUnitAnalysis>;
  synthesize(input: import("../assistant/grant-full-document-review-request.ts")
    .GrantFullDocumentSynthesisRequest): Promise<GrantFullDocumentAnalysisAnswer>;
}
