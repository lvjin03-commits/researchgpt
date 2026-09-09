import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantGeneralWebSearchService } from "../lib/grants/application/grant-general-web-search-service.ts";
import { GoogleCustomSearchProvider, GrantGoogleSearchError } from "../lib/grants/infrastructure/web/google-custom-search-provider.ts";

const audits: unknown[] = [];
const persistedSearches: unknown[] = [];
let requests = 0;
const observed = { url: null as URL | null };
const provider = new GoogleCustomSearchProvider({ apiKey: "test-key", engineId: "test-engine", request: async (resource) => {
  requests += 1;
  observed.url = new URL(String(resource));
  return new Response(JSON.stringify({ items: [
    { title: "University result", link: "https://lab.example.edu/study#section", snippet: "Relevant bounded snippet", cacheId: "cache-1" },
    { title: "Duplicate", link: "https://lab.example.edu/study#section", snippet: "Relevant bounded snippet", cacheId: "cache-1" },
    { title: "Malformed", link: "javascript:alert(1)", snippet: "must be discarded" },
  ] }), { status: 200, headers: { "content-type": "application/json" } });
} });
const sourceRepository = { async saveSearchResults(input: unknown) { persistedSearches.push(input); }, async appendUsageEvents() {}, async listTurnSources() { return []; } };
const service = new GrantGeneralWebSearchService({ provider, auditRepository: { async append(event) { audits.push(event); } }, sourceRepository, now: () => "2026-09-08T12:00:00.000Z" });

const result = await service.search({
  documentId: randomUUID(), sourceRevision: 2, actorId: randomUUID(), assistantSessionId: randomUUID(), turnId: randomUUID(),
  candidateQuery: "zinc ion battery electrolyte interface", documentText: "private application body",
  sensitiveTerms: ["Applicant Name"], maximumResults: 5,
});
assert.equal(result.status, "completed");
assert.equal(result.sources.length, 1, "fingerprint duplicates and malformed URLs must be removed");
assert.equal(result.sources[0]?.classification.qualityTier, "university_research");
assert.equal(requests, 1);
assert.equal(audits.length, 1, "audit must exist before external dispatch");
assert.equal(persistedSearches.length, 1);
assert.equal((persistedSearches[0] as { usageEvents: unknown[] }).usageEvents.length, 1);
assert.equal(observed.url?.origin, "https://customsearch.googleapis.com");
assert.equal(observed.url?.searchParams.get("q"), "zinc ion battery electrolyte interface");
assert.equal(observed.url?.searchParams.get("num"), "5");
assert.equal(observed.url?.searchParams.get("safe"), "active");

const blocked = await service.search({
  documentId: randomUUID(), sourceRevision: 1, actorId: randomUUID(), assistantSessionId: null, turnId: randomUUID(), candidateQuery: "Applicant Name project 5260022912",
  documentText: "application", sensitiveTerms: ["Applicant Name"],
});
assert.equal(blocked.status, "blocked");
assert.equal(requests, 1, "blocked query must never reach provider");
assert.equal(audits.length, 2);
assert.equal((audits[1] as { outgoingQuery: unknown }).outgoingQuery, null);

const noAuditService = new GrantGeneralWebSearchService({ provider, sourceRepository, auditRepository: { async append() { throw new Error("audit unavailable"); } } });
await assert.rejects(() => noAuditService.search({ documentId: randomUUID(), sourceRevision: 1, actorId: randomUUID(), assistantSessionId: null, turnId: randomUUID(), candidateQuery: "safe academic query", documentText: "", sensitiveTerms: [] }), /audit unavailable/u);
assert.equal(requests, 1, "failed audit persistence must fail closed before provider dispatch");

const limited = new GoogleCustomSearchProvider({ apiKey: "test", engineId: "test", request: async () => new Response("{}", { status: 429 }) });
const approved = result.decision;
if (!approved.allowed) throw new Error("test setup expected approved query");
await assert.rejects(() => limited.search({ approvedQuery: approved, maximumResults: 10 }), (error: unknown) => error instanceof GrantGoogleSearchError && error.category === "rate_limited");
assert.throws(() => new GoogleCustomSearchProvider({ apiKey: "", engineId: "test" }), /incomplete/u);

console.log("Google Custom Search adapter and audited offline search path verified without a real API call.");
