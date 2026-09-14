export type GrantFullDocumentAnalysisFinding = {
  statement: string;
  sourceAliases: string[];
};

export type GrantFullDocumentUnitAnalysis = {
  summary: string;
  findings: GrantFullDocumentAnalysisFinding[];
};

export type GrantFullDocumentAnalysisAnswer = {
  content: string;
  claims: GrantFullDocumentAnalysisFinding[];
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
