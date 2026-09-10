import type { GrantWebSearchEgressDecision } from "../web-sources/query-egress-policy.ts";

export interface GrantGeneralWebSearchProviderResult {
  providerId: "openai_web_search";
  providerRecordId: string | null;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

export interface GrantGeneralWebSearchProvider {
  readonly providerId: "openai_web_search";
  search(input: {
    approvedQuery: Extract<GrantWebSearchEgressDecision, { allowed: true }>;
    maximumResults: number;
  }): Promise<GrantGeneralWebSearchProviderResult[]>;
}
