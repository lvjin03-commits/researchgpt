import type {
  GrantStructuredAcademicSearchProvider,
  GrantStructuredAcademicSearchResult,
} from "../../ports/grant-structured-academic-search-provider.ts";
import { GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION } from "../../web-sources/query-egress-policy.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type OpenAlexWork = {
  id?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  doi?: string | null;
  is_retracted?: boolean | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null }> | null;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
};

function abstractFromIndex(index: OpenAlexWork["abstract_inverted_index"]): string | null {
  if (!index) return null;
  const words = Object.entries(index)
    .flatMap(([word, positions]) => positions.map((position) => ({ word, position })))
    .sort((left, right) => left.position - right.position)
    .map(({ word }) => word).join(" ").replace(/\s+/gu, " ").trim();
  return words || null;
}

function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/^http:\/\/doi\.org\//iu, "https://doi.org/")
    .replace(/^https:\/\/dx\.doi\.org\//iu, "https://doi.org/");
  if (/^10\.\d{4,9}\//u.test(normalized)) return `https://doi.org/${normalized}`;
  return normalized.startsWith("https://doi.org/") ? normalized : null;
}

function normalizeWork(work: OpenAlexWork): GrantStructuredAcademicSearchResult | null {
  const match = work.id?.match(/\/works\/(W\d+)$/u) ?? work.id?.match(/\/(W\d+)$/u);
  if (!match || !work.display_name?.trim()) return null;
  const providerRecordId = match[1]!;
  return {
    providerId: "openalex",
    providerRecordId,
    url: `https://openalex.org/${providerRecordId}`,
    title: work.display_name.trim(),
    abstract: abstractFromIndex(work.abstract_inverted_index),
    publicationYear: Number.isInteger(work.publication_year) ? work.publication_year! : null,
    publicationDate: /^\d{4}-\d{2}-\d{2}$/u.test(work.publication_date ?? "") ? work.publication_date! : null,
    doi: normalizeDoi(work.doi),
    venue: work.primary_location?.source?.display_name?.trim() || null,
    authors: (work.authorships ?? []).map((entry) => entry.author?.display_name?.trim())
      .filter((name): name is string => Boolean(name)),
    retracted: work.is_retracted === true,
  };
}

export class OpenAlexStructuredAcademicProvider implements GrantStructuredAcademicSearchProvider {
  readonly providerId = "openalex" as const;
  private readonly fetcher: FetchLike;

  constructor(fetcher: FetchLike = fetch) { this.fetcher = fetcher; }

  async search(input: Parameters<GrantStructuredAcademicSearchProvider["search"]>[0]) {
    if (!input.approvedQuery.allowed || input.approvedQuery.policyVersion !== GRANT_WEB_SEARCH_EGRESS_POLICY_VERSION) {
      throw new Error("Academic search query has not passed the current egress policy.");
    }
    if (!Number.isInteger(input.maximumResults) || input.maximumResults < 1 || input.maximumResults > 25) {
      throw new Error("OpenAlex result limit must be between 1 and 25.");
    }
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", input.approvedQuery.outgoingQuery);
    url.searchParams.set("per-page", String(input.maximumResults));
    url.searchParams.set("select", ["id", "display_name", "publication_year", "publication_date", "doi",
      "is_retracted", "authorships", "primary_location", "abstract_inverted_index"].join(","));
    const response = await this.fetcher(url, {
      headers: { Accept: "application/json", "User-Agent": "ResearchGPT/1.0 (structured academic search)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`OpenAlex search failed with HTTP ${response.status}.`);
    const payload = await response.json() as { results?: OpenAlexWork[] };
    const seen = new Set<string>();
    const results = (payload.results ?? []).flatMap((work) => {
      const normalized = normalizeWork(work);
      if (!normalized || normalized.retracted || seen.has(normalized.providerRecordId)) return [];
      seen.add(normalized.providerRecordId);
      return [normalized];
    });
    return { results, usage: { requestCount: 1 as const } };
  }
}

