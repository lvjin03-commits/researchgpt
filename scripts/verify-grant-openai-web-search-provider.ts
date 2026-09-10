import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantGeneralWebSearchService } from "../lib/grants/application/grant-general-web-search-service.ts";
import { GrantOpenAIWebSearchError, OpenAIWebSearchProvider } from "../lib/grants/infrastructure/model/openai-web-search-provider.ts";

const audits: unknown[] = [];
const persistedSearches: unknown[] = [];
let requests = 0;
let observedInput: Record<string, unknown> = {};
const provider = new OpenAIWebSearchProvider({ apiKey: "", modelId: "gpt-test", client: { responses: { async create(input) {
  requests += 1;
  observedInput = input as Record<string, unknown>;
  return {
    id: "resp_test",
    output: [{ type: "message", content: [{ type: "output_text", text: "University researchers report a relevant electrolyte-interface result.\nA second sentence repeats the same citation.", annotations: [
      { type: "url_citation", start_index: 0, end_index: 71, title: "University result", url: "https://lab.example.edu/study#section" },
      { type: "url_citation", start_index: 72, end_index: 116, title: "Duplicate", url: "https://lab.example.edu/study#section" },
    ] }] }],
  };
} } } });
const sourceRepository = { async saveSearchResults(input: unknown) { persistedSearches.push(input); }, async appendUsageEvents() {}, async listTurnSources() { return []; } };
const service = new GrantGeneralWebSearchService({ provider, auditRepository: { async append(event) { audits.push(event); } }, sourceRepository, now: () => "2026-09-10T12:00:00.000Z" });

const result = await service.search({
  documentId: randomUUID(), sourceRevision: 2, actorId: randomUUID(), assistantSessionId: randomUUID(), turnId: randomUUID(),
  candidateQuery: "zinc ion battery electrolyte interface", documentText: "private application body",
  sensitiveTerms: ["Applicant Name"], maximumResults: 5,
});
assert.equal(result.status, "completed");
assert.equal(result.sources.length, 1, "duplicate cited URLs must be removed");
assert.equal(result.sources[0]?.classification.qualityTier, "university_research");
assert.equal(result.sources[0]?.providerId, "openai_web_search");
assert.equal(requests, 1);
assert.equal(audits.length, 1, "audit must exist before external dispatch");
assert.equal(persistedSearches.length, 1);
assert.equal((persistedSearches[0] as { usageEvents: unknown[] }).usageEvents.length, 1);
assert.deepEqual(observedInput?.include, ["web_search_call.action.sources"]);
assert.equal((observedInput?.tools as Array<{ type: string }>)[0]?.type, "web_search");
assert.equal(((observedInput?.input as Array<{ role: string; content: string }>)[1]?.content), "zinc ion battery electrolyte interface");

const blocked = await service.search({
  documentId: randomUUID(), sourceRevision: 1, actorId: randomUUID(), assistantSessionId: null, turnId: randomUUID(), candidateQuery: "Applicant Name project 5260022912",
  documentText: "application", sensitiveTerms: ["Applicant Name"],
});
assert.equal(blocked.status, "blocked");
assert.equal(requests, 1, "blocked query must never reach provider");
assert.equal((audits[1] as { outgoingQuery: unknown }).outgoingQuery, null);

const approved = result.decision;
if (!approved.allowed) throw new Error("test setup expected approved query");
await assert.rejects(
  () => provider.search({ approvedQuery: approved, maximumResults: 11 }),
  (error: unknown) => error instanceof GrantOpenAIWebSearchError && error.category === "configuration_invalid",
);
assert.throws(() => new OpenAIWebSearchProvider({ apiKey: "", modelId: "" }), /incomplete/u);

console.log("OpenAI web-search adapter and audited offline search path verified without a paid API call.");
