import type { GrantWebSearchEgressDecision } from "../web-sources/query-egress-policy.ts";

export interface GrantStructuredAcademicSearchResult {
  providerId: "openalex";
  providerRecordId: string;
  url: string;
  title: string;
  abstract: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  doi: string | null;
  venue: string | null;
  authors: string[];
  retracted: boolean;
}

export interface GrantStructuredAcademicSearchProvider {
  readonly providerId: "openalex";
  search(input: {
    approvedQuery: Extract<GrantWebSearchEgressDecision, { allowed: true }>;
    maximumResults: number;
  }): Promise<{ results: GrantStructuredAcademicSearchResult[]; usage: { requestCount: 1 } }>;
}

