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
};

export interface GrantDiagnosticModel {
  diagnose(request: GrantDiagnosticModelRequest): Promise<GrantDiagnosticModelResult>;
}
