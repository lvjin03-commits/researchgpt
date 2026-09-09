import type { GrantWebSearchEgressDecision } from "../web-sources/query-egress-policy.ts";

export interface GrantGeneralWebSearchProviderResult {
  providerId: "google_custom_search";
  providerRecordId: string | null;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
}

export interface GrantGeneralWebSearchProvider {
  readonly providerId: "google_custom_search";
  search(input: {
    approvedQuery: Extract<GrantWebSearchEgressDecision, { allowed: true }>;
    maximumResults: number;
  }): Promise<GrantGeneralWebSearchProviderResult[]>;
}
