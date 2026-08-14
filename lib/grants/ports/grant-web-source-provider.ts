export interface GrantWebSearchProvider {
  search(input: { query: string; maximumResults: number }): Promise<Array<{ title: string; url: string; snippet: string; provider: string }>>;
}

export interface GrantWebSourceFetcher {
  fetchSnapshot(input: { url: string; maximumBytes: number }): Promise<{ finalUrl: string; title: string; text: string; mediaType: string }>;
}

