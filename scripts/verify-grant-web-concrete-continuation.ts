import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResumableWebAnswerBudgetCoordinator } from "../lib/billing/application/resumable-web-answer-budget-coordinator.ts";
import { AiPricePolicySchema } from "../lib/billing/domain/price-catalog.ts";
import { GrantWebBudgetedPhaseOrchestrator } from "../lib/grants/application/grant-web-budgeted-phase-orchestrator.ts";
import { GrantWebConcreteContinuationStepExecutor } from "../lib/grants/application/grant-web-concrete-continuation-executor.ts";
import { GrantGeneralWebSearchService } from "../lib/grants/application/grant-general-web-search-service.ts";
import { GrantModelExecutor } from "../lib/grants/application/grant-model-executor.ts";
import { GrantWebBudgetCommandService } from "../lib/grants/application/grant-web-budget-commands.ts";
import { GrantWebResumablePhaseExecutor } from "../lib/grants/application/grant-web-resumable-flow.ts";
import { AI_OPERATIONS } from "../lib/ai/operation-registry.ts";
import type { RegisteredAiOperation } from "../lib/ai/operation-registry.ts";
import type { GrantWebSourceRecord } from "../lib/grants/web-sources/contracts.ts";

const ownerId = randomUUID();
const documentId = randomUUID();
const turnId = randomUUID();
const sessionId = randomUUID();
const contextHash = "a".repeat(64);
const authorizationFingerprint = "b".repeat(64);
const calls: string[] = [];
const auditedQueries: string[] = [];
let searchNumber = 0;
let storedCheckpoint: unknown;
const coordinator = new ResumableWebAnswerBudgetCoordinator({
  async reserve() { calls.push("reserve"); },
  async settle(input) { calls.push("settle"); storedCheckpoint = input.checkpointArtifact; },
  async release() { calls.push("release"); },
});
const webRepository = {
  async saveSearchResults() { calls.push("save-search"); },
  async appendUsageEvents() {},
  async listTurnSources() { return []; },
};
const searchService = new GrantGeneralWebSearchService({
  provider: { providerId: "openalex", async search(input) {
    calls.push("provider-search");
    searchNumber += 1;
    return { results: [{ providerId: "openalex" as const, providerRecordId: `W${searchNumber}`,
      title: `Structured academic study ${searchNumber}`, url: `https://openalex.org/W${searchNumber}`,
      snippet: `Real structured abstract for research dimension ${searchNumber}.`,
      publishedAt: "2026-01-01T00:00:00.000Z" }], usage: { providerRequestId: `search-${searchNumber}`,
      webSearchCalls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 } };
  } },
  auditRepository: { async append(audit) {
    calls.push("audit");
    if (!audit.outgoingQuery) throw new Error("Allowed search audit must retain its outgoing query.");
    auditedQueries.push(audit.outgoingQuery);
  } },
  sourceRepository: webRepository,
});
const model = {
  async rewriteQuery() { calls.push("model-rewrite"); return { value: { query: "safe research query" }, outputHash: "c".repeat(64),
    usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } }; },
  async assess(input: { sources: readonly GrantWebSourceRecord[] }) { calls.push("model-assess"); return {
    value: { assessments: input.sources.map((source) => ({ sourceId: source.sourceId,
      disposition: "recommended" as const, reason: "Relevant" })) }, outputHash: "d".repeat(64),
    usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } }; },
  async synthesize(input: { sources: readonly GrantWebSourceRecord[] }) { calls.push("model-synthesize"); return {
    value: { claims: [{ claimId: randomUUID(), statement: "Grounded conclusion.",
      sourceIds: [input.sources[0]!.sourceId] }] }, outputHash: "e".repeat(64),
    usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 0 } }; },
};
const modelExecutor = new GrantModelExecutor({
  async start() {}, async finish() {}, async listByTrace() { return []; },
} as never);
const operations = [AI_OPERATIONS.grant.webQueryRewrite, AI_OPERATIONS.grant.webSearchQuery,
  AI_OPERATIONS.grant.webSourceAssess, AI_OPERATIONS.grant.webAnswerSynthesize,
  AI_OPERATIONS.grant.webExistingResultsDeliver];
const policies = new Map<RegisteredAiOperation, ReturnType<typeof AiPricePolicySchema.parse>>(operations.map((operation) => [operation, AiPricePolicySchema.parse({
  policyVersion: `test:${operation}`, operation, provider: "openai", modelId: "test-model",
  tokenRates: { inputMicroUsdPerMillion: 1, cachedInputMicroUsdPerMillion: 1, outputMicroUsdPerMillion: 1 },
  unitRates: operation === AI_OPERATIONS.grant.webSearchQuery
    ? [{ usageKind: "tool_call", discriminator: "openai_web_search", microUsdPerUnit: 1, unitSize: 1 }] : [],
  cnyMicrosPerUsd: 1, markupBasisPoints: 0, rounding: "ceil_to_whole_point",
  effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveUntil: null,
})]));
const prices = {
  async getPolicy(input: { operation: RegisteredAiOperation }) { return policies.get(input.operation) ?? null; },
  async getPolicyByVersion(version: string) { return [...policies.values()].find((policy) => policy.policyVersion === version) ?? null; },
  async putPolicy() {},
};
let contextLoads = 0;
const executor = new GrantWebConcreteContinuationStepExecutor({
  phases: new GrantWebResumablePhaseExecutor(new GrantWebBudgetedPhaseOrchestrator(coordinator)),
  contextLoader: { async load() { contextLoads += 1; return { question: "What changed?", applicationContext: "Authorized excerpt",
    documentTextForEgressCheck: "Public-safe document text", sensitiveTerms: [], assistantSessionId: sessionId,
    sourceRevision: 1, contextHash, authorizationFingerprint }; } },
  model, modelExecutor, searchService, sourceRepository: webRepository, prices,
  configuredGrantModelId: "test-model",
});
const workflow = new GrantWebBudgetCommandService({
  async create(next, checkpoint) { storedCheckpoint = checkpoint; return next; }, async get() { return null; },
  async authorizeIncrease(_previous, _id, _points, next) { return next; },
  async transition(_previous, next) { return next; },
}, undefined, executor);
const result = await workflow.start({ budgetId: randomUUID(), authorizationId: randomUUID(), ownerId,
  documentId, turnId, assistantSessionId: sessionId, question: "What changed?", authorizedPoints: 100,
  sourceRevision: 1, contextHash, authorizationFingerprint });
assert.equal(result.status, "completed");
if (result.status !== "completed") throw new Error("Expected completed continuation.");
assert.equal(result.state.status, "delivered_complete");
assert.equal(result.checkpoint.answer?.claims[0]?.statement, "Grounded conclusion.");
assert.equal(contextLoads, 4, "authoritative context must be rebuilt before every paid phase");
assert.equal(calls.filter((value) => value === "reserve").length, 4);
assert.ok(calls.indexOf("reserve") < calls.indexOf("model-rewrite"), "reservation must precede model dispatch");
assert.ok(calls.indexOf("audit") < calls.indexOf("provider-search"), "egress audit must precede web dispatch");
assert.equal(calls.filter((value) => value === "audit").length, 5, "all five complementary queries must be audited");
assert.equal(calls.filter((value) => value === "provider-search").length, 5);
assert.equal(new Set(auditedQueries).size, 5, "research queries must be complementary, not repeated");
assert.equal(result.checkpoint.search?.sources.length, 5, "all structured abstracts must reach assessment");
assert.ok(storedCheckpoint && typeof storedCheckpoint === "object");
console.log("The formal Grant web path audited five complementary OpenAlex queries, merged real abstracts and delivered offline.");
