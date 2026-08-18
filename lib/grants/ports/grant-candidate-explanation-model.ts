import type { GrantCandidateDiff } from "../edit-session/candidate-diff.ts";
import type { GrantCandidateExplanationModelResult } from "../edit-session/candidate-explanation.ts";

export type GrantCandidateExplanationModelRequest = {
  documentLanguage: "zh" | "en";
  diff: GrantCandidateDiff;
  blockingIssues: Array<{ code: string; message: string }>;
  sources: Array<{ sourceTitle: string; currentlyAuthorized: boolean; status: "current" | "revoked" | "expired" | "changed" }>;
  attemptPurpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry";
};

export type GrantCandidateExplanationModelResponse = GrantCandidateExplanationModelResult & {
  provider: "openai";
  modelId: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
};

export class GrantCandidateExplanationModelError extends Error {
  readonly category: "structured_output_invalid" | "output_truncated" | "content_filtered" | "provider_refusal" | "provider_rate_limited" | "provider_transient_error" | "provider_contract_error" | "provider_unavailable";
  constructor(category: GrantCandidateExplanationModelError["category"], message: string) {
    super(message);
    this.name = "GrantCandidateExplanationModelError";
    this.category = category;
  }
}

export interface GrantCandidateExplanationModel {
  explainCandidate(request: GrantCandidateExplanationModelRequest): Promise<GrantCandidateExplanationModelResponse>;
}
