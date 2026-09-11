import assert from "node:assert/strict";
import { OpenAlexResearchSearchAdapter } from "../lib/grants/infrastructure/web/openalex-research-search-adapter.ts";

const approvedQuery = { allowed: true as const, policyVersion: "grant-web-query-egress-v1",
  outgoingQuery: "aqueous zinc electrolyte solvation", candidateHash: "a".repeat(64), issues: [] as const };
let receivedQuery = "";
const adapter = new OpenAlexResearchSearchAdapter({ providerId: "openalex", async search(input) {
  receivedQuery = input.approvedQuery.outgoingQuery;
  return { results: [{ providerId: "openalex" as const, providerRecordId: "W1",
    url: "https://openalex.org/W1", title: "Structured study", abstract: "A real structured abstract with 99.9% efficiency.",
    publicationYear: 2026, publicationDate: "2026-03-01", doi: "https://doi.org/10.1000/test",
    venue: "Journal", authors: ["Author"], retracted: false }], usage: { requestCount: 1 as const } };
} });
const result = await adapter.search({ approvedQuery, maximumResults: 10 });
assert.equal(receivedQuery, approvedQuery.outgoingQuery, "the audited query must be dispatched unchanged");
assert.equal(result.results[0]?.snippet, "A real structured abstract with 99.9% efficiency.");
assert.equal(result.results[0]?.providerId, "openalex");
assert.equal(result.results[0]?.publishedAt, "2026-03-01T00:00:00.000Z");
assert.equal(result.usage.webSearchCalls, 0, "OpenAlex must not be billed as an OpenAI web-search tool call");
console.log("OpenAlex research adapter preserves the audited query and exposes structured abstracts.");
