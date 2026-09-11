import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantGeneralWebSearchService } from "../lib/grants/application/grant-general-web-search-service.ts";
import { GrantModelExecutor } from "../lib/grants/application/grant-model-executor.ts";
import { GrantWebGroundedChatOrchestrator } from "../lib/grants/application/grant-web-grounded-chat-orchestrator.ts";
import { sha256Canonical } from "../lib/grants/domain/canonical-json.ts";
import type { GrantModelCallAttempt } from "../lib/grants/model-execution/contracts.ts";
import type { GrantModelCallRepository } from "../lib/grants/ports/grant-model-call-repository.ts";
import type { GrantWebGroundingRepository } from "../lib/grants/ports/grant-web-grounding-repository.ts";
import type { GrantWebSourceRecord, GrantWebSourceUsageEvent } from "../lib/grants/web-sources/contracts.ts";

class Calls implements GrantModelCallRepository {
  readonly attempts: GrantModelCallAttempt[] = [];
  async start(attempt: GrantModelCallAttempt) { this.attempts.push(structuredClone(attempt)); return attempt; }
  async finish(input: Parameters<GrantModelCallRepository["finish"]>[0]) {
    const index = this.attempts.findIndex((attempt) => attempt.callId === input.callId);
    if (index < 0) throw new Error("missing call");
    const { expectedStatus: _expectedStatus, ...completion } = input;
    this.attempts[index] = { ...this.attempts[index]!, ...completion } as GrantModelCallAttempt;
    return this.attempts[index]!;
  }
  async listByTrace(documentId: string, traceId: string) { return this.attempts.filter((item) => item.documentId === documentId && item.traceId === traceId); }
}

class Sources implements GrantWebGroundingRepository {
  readonly records = new Map<string, GrantWebSourceRecord>();
  readonly events: GrantWebSourceUsageEvent[] = [];
  async saveSearchResults(input: { documentId: string; searchAuditId: string; sources: GrantWebSourceRecord[]; usageEvents: GrantWebSourceUsageEvent[] }) {
    input.sources.forEach((source) => this.records.set(source.sourceId, source)); this.events.push(...input.usageEvents);
  }
  async appendUsageEvents(input: { documentId: string; events: GrantWebSourceUsageEvent[] }) { this.events.push(...input.events); }
  async listTurnSources(input: { documentId: string; turnId: string }) {
    return this.events.filter((event) => event.documentId === input.documentId && event.turnId === input.turnId)
      .map((event) => ({ source: this.records.get(event.sourceId)!, eventType: event.eventType }));
  }
}

const documentId = randomUUID();
const actorId = randomUUID();
const sessionId = randomUUID();
const turnId = randomUUID();
const calls = new Calls();
const sources = new Sources();
const audits: unknown[] = [];
const observedBillingOperationIds: string[] = [];
const searchService = new GrantGeneralWebSearchService({
  provider: { providerId: "openai_web_search", async search() { return {
    results: [
      { providerId: "openai_web_search" as const, providerRecordId: "one", title: "University review",
        url: "https://lab.example.edu/review", snippet: "A review connects electrolyte solvation with zinc interface stability and deposition behavior.", publishedAt: null },
      { providerId: "openai_web_search" as const, providerRecordId: "two", title: "Commercial blog",
        url: "https://blog.example/post", snippet: "A generic consumer battery article.", publishedAt: null },
    ],
    usage: { providerRequestId: "resp_search", webSearchCalls: 1, inputTokens: 8000,
      cachedInputTokens: 0, outputTokens: 120, reasoningTokens: 20 },
  }; } },
  auditRepository: { async append(audit) { audits.push(audit); } }, sourceRepository: sources,
  onProviderUsage: async (event) => { observedBillingOperationIds.push(event.billingOperationId); },
  now: () => "2026-09-08T12:00:00.000Z",
});
let assessedSourceIds: string[] = [];
const model = {
  async rewriteQuery() { const value = { query: "zinc electrolyte solvation interface stability" }; return { value, outputHash: sha256Canonical(value),
    usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5 } }; },
  async assess(input: { sources: readonly GrantWebSourceRecord[] }) {
    assessedSourceIds = input.sources.map((source) => source.sourceId);
    const value = { assessments: input.sources.map((source, index) => ({ sourceId: source.sourceId,
      disposition: index === 0 ? "recommended" as const : "excluded" as const, reason: index === 0 ? "Relevant university source." : "Insufficient relevance." })) };
    return { value, outputHash: sha256Canonical(value), usage: { inputTokens: 200, outputTokens: 40, reasoningTokens: 10 } };
  },
  async synthesize(input: { sources: readonly GrantWebSourceRecord[] }) {
    const value = { claims: [{ claimId: randomUUID(), statement: "外部综述支持从溶剂化环境与界面稳定性的关联来审视该研究方案。", sourceIds: [input.sources[0]!.sourceId] }] };
    return { value, outputHash: sha256Canonical(value), usage: { inputTokens: 300, outputTokens: 60, reasoningTokens: 15 } };
  },
};
const orchestrator = new GrantWebGroundedChatOrchestrator({ model, modelExecutor: new GrantModelExecutor(calls, undefined, undefined,
  async (event) => { observedBillingOperationIds.push(event.billingOperationId); }),
  searchService, sourceRepository: sources, configuredGrantModelId: "offline-model" });
const context = { schemaVersion: 1 as const, documentId, sourceRevisionId: randomUUID(), documentLanguage: "zh" as const,
  applicationContext: "申请书讨论锌电池电解液与界面稳定性。", contextHash: sha256Canonical("admitted") };
const result = await orchestrator.run({ documentId, sourceRevision: 3, actorId, assistantSessionId: sessionId,
  turnId, question: "联网补充研究方案的相关信息", context, documentTextForEgressCheck: context.applicationContext, sensitiveTerms: [] });
assert.equal(result.status, "completed");
if (result.status !== "completed") throw new Error("expected completed result");
assert.equal(result.answer.citations[0]?.sourceType, "web_source");
assert.deepEqual(calls.attempts.map((attempt) => attempt.operation), [
  "grant.web_query.rewrite", "grant.web_source.assess", "grant.web_answer.synthesize",
]);
assert.equal(new Set(calls.attempts.map((attempt) => attempt.traceId)).size, 3, "each paid model phase needs an independent trace");
assert.equal(new Set(calls.attempts.map((attempt) => attempt.turnId)).size, 1, "all stages remain attached to one visible turn");
assert.equal(new Set(observedBillingOperationIds).size, 4, "each metered stage needs an independent billing operation ID");
assert.ok(calls.attempts.every((attempt) => attempt.status === "succeeded"));
assert.equal(audits.length, 1);
assert.equal(assessedSourceIds.length, 2);
assert.deepEqual(result.billingUsage.search, [
  { kind: "tool_call", tool: "openai_web_search", count: 1 },
  { kind: "tokens", inputTokens: 8000, cachedInputTokens: 0, outputTokens: 120, reasoningTokens: 20 },
]);
assert.deepEqual(sources.events.map((event) => event.eventType).sort(), ["cited", "excluded", "recommended", "retrieved", "retrieved"].sort());
assert.ok(sources.events.every((event) => event.documentId === documentId && event.turnId === turnId));

const blocked = await orchestrator.run({ documentId, sourceRevision: 3, actorId, assistantSessionId: sessionId,
  turnId: randomUUID(), question: "search", context, documentTextForEgressCheck: "", sensitiveTerms: ["Applicant Name"] });
assert.equal(blocked.status, "completed", "safe rewritten query remains usable even when sensitive terms exist outside it");

console.log("Grant web-grounded chat orchestration verified offline: gateway-shaped context, three traced model phases, audited search, source events and canonical assistant answer.");
