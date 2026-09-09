import type {
  GrantWebAnswerProposal,
  GrantWebQueryRewriteProposal,
  GrantWebSourceAssessmentProposal,
  GrantWebSourceRecord,
} from "../web-sources/contracts.ts";

export type GrantWebModelResult<T> = {
  value: T;
  outputHash: string;
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number };
};

export type GrantWebModelAttemptPurpose = "initial" | "schema_repair" | "capacity_retry" | "transient_retry";

export type GrantWebModelFailureCategory =
  | "structured_output_invalid" | "output_truncated" | "content_filtered"
  | "provider_refusal" | "provider_rate_limited" | "provider_transient_error"
  | "provider_contract_error" | "provider_unavailable";

export class GrantWebModelError extends Error {
  readonly category: GrantWebModelFailureCategory;
  constructor(category: GrantWebModelFailureCategory, message: string) {
    super(message); this.category = category; this.name = "GrantWebModelError";
  }
}

export interface GrantWebGroundingModel {
  rewriteQuery(input: {
    question: string;
    admittedApplicationContext: string;
    attemptPurpose: GrantWebModelAttemptPurpose;
  }): Promise<GrantWebModelResult<GrantWebQueryRewriteProposal>>;
  assess(input: {
    question: string;
    admittedApplicationContext: string;
    sources: readonly GrantWebSourceRecord[];
    attemptPurpose: GrantWebModelAttemptPurpose;
  }): Promise<GrantWebModelResult<GrantWebSourceAssessmentProposal>>;
  synthesize(input: {
    question: string;
    admittedApplicationContext: string;
    sources: readonly GrantWebSourceRecord[];
    attemptPurpose: GrantWebModelAttemptPurpose;
  }): Promise<GrantWebModelResult<GrantWebAnswerProposal>>;
}
