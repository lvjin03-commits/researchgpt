import type { GrantGeneralWebSearchProvider } from "../../ports/grant-general-web-search-provider.ts";
import type { GrantStructuredAcademicSearchProvider } from "../../ports/grant-structured-academic-search-provider.ts";

export class OpenAlexResearchSearchAdapter implements GrantGeneralWebSearchProvider {
  readonly providerId = "openalex" as const;
  private readonly provider: GrantStructuredAcademicSearchProvider;
  constructor(provider: GrantStructuredAcademicSearchProvider) { this.provider = provider; }

  async search(input: Parameters<GrantGeneralWebSearchProvider["search"]>[0]) {
    const response = await this.provider.search({ approvedQuery: input.approvedQuery,
      maximumResults: Math.min(10, input.maximumResults) });
    const seen = new Set<string>();
    const results = response.results.flatMap((work) => {
      if (!work.abstract || seen.has(work.providerRecordId)) return [];
      seen.add(work.providerRecordId);
      return [{ providerId: "openalex" as const, providerRecordId: work.providerRecordId,
        title: work.title, url: work.doi ?? work.url, snippet: work.abstract.slice(0, 1200),
        publishedAt: work.publicationDate ? `${work.publicationDate}T00:00:00.000Z`
          : work.publicationYear ? `${work.publicationYear}-01-01T00:00:00.000Z` : null }];
    }).slice(0, input.maximumResults);
    return { results, usage: { providerRequestId: `openalex:${Date.now()}`, webSearchCalls: 0,
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } };
  }
}
