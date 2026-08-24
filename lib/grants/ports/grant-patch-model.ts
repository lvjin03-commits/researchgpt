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
  images?: Array<{ assetRef: string; caption?: string; mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; dataUrl: string }>;
};

export type GrantPatchModelResult = {
  replacementText: string;
  rationale?: string;
  provider: "openai";
  modelId: string;
  usedEvidenceCardIds: string[];
  usage?: { inputTokens: number; outputTokens: number; reasoningTokens: number };
};

export interface GrantPatchModel {
  generate(request: GrantPatchModelRequest): Promise<GrantPatchModelResult>;
}
