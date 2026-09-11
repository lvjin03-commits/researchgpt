import type { GrantWebSearchEgressDecision } from "../web-sources/query-egress-policy.ts";

export interface GrantGeneralWebSearchProviderResult {
  providerId: "openai_web_search" | "openalex";
  providerRecordId: string | null;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

export interface GrantGeneralWebSearchProviderUsage {
  providerRequestId: string;
  webSearchCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface GrantGeneralWebSearchProviderResponse {
  results: GrantGeneralWebSearchProviderResult[];
  usage: GrantGeneralWebSearchProviderUsage;
}

export interface GrantGeneralWebSearchProvider {
  readonly providerId: "openai_web_search" | "openalex";
  search(input: {
    approvedQuery: Extract<GrantWebSearchEgressDecision, { allowed: true }>;
    maximumResults: number;
  }): Promise<GrantGeneralWebSearchProviderResponse>;
}
