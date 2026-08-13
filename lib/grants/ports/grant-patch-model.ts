export type GrantPatchEvidenceExcerpt = {
  sourceId: string;
  cardId: string;
  sourceTitle: string;
  provenanceType: "published_literature" | "own_unpublished_work" | "project_material";
  excerpt: string;
};

export type GrantPatchModelRequest = {
  documentLanguage: "zh" | "en";
  sectionTitle: string;
  targetText: string;
  findingMessage?: string;
  findingRecommendation?: string;
  userInstruction: string;
  editMode: "replace" | "replace_selection" | "insert_after";
  evidence: GrantPatchEvidenceExcerpt[];
};

export type GrantPatchModelResult = {
  replacementText: string;
  rationale?: string;
  provider: "openai";
  modelId: string;
  usedEvidenceCardIds: string[];
};

export interface GrantPatchModel {
  generate(request: GrantPatchModelRequest): Promise<GrantPatchModelResult>;
}
