import { z } from "zod";
import type { GrantGeneralWebSearchProvider } from "../../ports/grant-general-web-search-provider.ts";
import { GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION } from "../../web-sources/query-egress-policy.ts";

const GoogleSearchResponseSchema = z.object({
  items: z.array(z.object({
    title: z.string().trim().min(1).max(500),
    link: z.string().url().max(3000),
    snippet: z.string().trim().min(1).max(1200),
    cacheId: z.string().trim().min(1).max(500).optional(),
  }).passthrough()).max(10).optional(),
}).passthrough();

export type GrantGoogleSearchFailureCategory =
  | "configuration_invalid" | "egress_not_approved" | "rate_limited"
  | "provider_rejected" | "provider_unavailable" | "response_invalid";

export class GrantGoogleSearchError extends Error {
  readonly category: GrantGoogleSearchFailureCategory;
  constructor(category: GrantGoogleSearchFailureCategory, message: string) {
    super(message); this.category = category; this.name = "GrantGoogleSearchError";
  }
}

export class GoogleCustomSearchProvider implements GrantGeneralWebSearchProvider {
  readonly providerId = "google_custom_search" as const;
  private readonly apiKey: string;
  private readonly engineId: string;
  private readonly request: typeof fetch;

  constructor(input: { apiKey: string; engineId: string; request?: typeof fetch }) {
    this.apiKey = input.apiKey.trim();
    this.engineId = input.engineId.trim();
    this.request = input.request ?? fetch;
    if (!this.apiKey || !this.engineId) throw new GrantGoogleSearchError("configuration_invalid", "Google search configuration is incomplete.");
  }

  async search(input: Parameters<GrantGeneralWebSearchProvider["search"]>[0]) {
    if (!input.approvedQuery.allowed || input.approvedQuery.policyVersion !== GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION) {
      throw new GrantGoogleSearchError("egress_not_approved", "Search query has not passed the current egress policy.");
    }
    if (!Number.isInteger(input.maximumResults) || input.maximumResults < 1 || input.maximumResults > 10) {
      throw new GrantGoogleSearchError("configuration_invalid", "Google result limit must be between 1 and 10.");
    }
    const url = new URL("https://customsearch.googleapis.com/customsearch/v1");
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("cx", this.engineId);
    url.searchParams.set("q", input.approvedQuery.outgoingQuery);
    url.searchParams.set("num", String(input.maximumResults));
    url.searchParams.set("safe", "active");
    let response: Response;
    try {
      response = await this.request(url, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    } catch {
      throw new GrantGoogleSearchError("provider_unavailable", "Google search is temporarily unavailable.");
    }
    if (response.status === 429) throw new GrantGoogleSearchError("rate_limited", "Google search quota is temporarily exhausted.");
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new GrantGoogleSearchError("provider_rejected", "Google rejected the search request.");
    }
    if (!response.ok) throw new GrantGoogleSearchError("provider_unavailable", `Google search returned HTTP ${response.status}.`);
    let payload: unknown;
    try { payload = await response.json(); } catch {
      throw new GrantGoogleSearchError("response_invalid", "Google search returned invalid JSON.");
    }
    const parsed = GoogleSearchResponseSchema.safeParse(payload);
    if (!parsed.success) throw new GrantGoogleSearchError("response_invalid", "Google search response did not match the expected contract.");
    return (parsed.data.items ?? []).map((item) => ({
      providerId: this.providerId,
      providerRecordId: item.cacheId ?? null,
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      publishedAt: null,
    }));
  }
}
