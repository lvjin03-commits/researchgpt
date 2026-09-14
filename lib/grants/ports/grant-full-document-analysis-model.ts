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
  analyzeUnit(input: {
    documentLanguage: "zh" | "en";
    question: string;
    contextHash: string;
    unitId: string;
    modelText: string;
    allowedSourceAliases: string[];
  }): Promise<GrantFullDocumentUnitAnalysis>;
  synthesize(input: {
    documentLanguage: "zh" | "en";
    question: string;
    contextHash: string;
    analyses: Array<{ unitId: string; summary: string; findings: GrantFullDocumentAnalysisFinding[] }>;
    allowedSourceAliases: string[];
  }): Promise<GrantFullDocumentAnalysisAnswer>;
}
