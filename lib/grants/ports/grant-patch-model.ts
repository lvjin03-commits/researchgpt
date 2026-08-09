export type GrantPatchModelRequest = {
  documentLanguage: "zh" | "en";
  sectionTitle: string;
  targetText: string;
  findingMessage?: string;
  findingRecommendation?: string;
  userInstruction: string;
};

export type GrantPatchModelResult = {
  replacementText: string;
  rationale?: string;
  provider: "deepseek" | "openai";
  modelId: string;
};

export interface GrantPatchModel {
  generate(request: GrantPatchModelRequest): Promise<GrantPatchModelResult>;
}

