import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AiUsageIntegration, resolveAiBillingIntegrationMode, type AiUsageEventSink } from "../lib/billing/application/ai-usage-integration.ts";
import type { AiUsageEnvelope } from "../lib/ai/billable-usage.ts";
import { AI_OPERATIONS } from "../lib/ai/operation-registry.ts";
import { GrantModelExecutor } from "../lib/grants/application/grant-model-executor.ts";
import type { GrantModelCallAttempt } from "../lib/grants/model-execution/contracts.ts";
import type { GrantModelCallRepository } from "../lib/grants/ports/grant-model-call-repository.ts";
import { resolveGrantModelOperationPolicy } from "../lib/grants/model-execution/operation-registry.ts";

class MemorySink implements AiUsageEventSink {
  readonly rows: Array<{ ownerId: string; envelope: AiUsageEnvelope }> = [];
  async append(ownerId: string, envelope: AiUsageEnvelope) {
    if (this.rows.some((row) => row.envelope.usageEventId === envelope.usageEventId)) return;
    this.rows.push({ ownerId, envelope });
  }
}

class MemoryGrantCalls implements GrantModelCallRepository {
  readonly rows = new Map<string, GrantModelCallAttempt>();
  async start(attempt: GrantModelCallAttempt) {
    this.rows.set(attempt.callId, attempt);
    return attempt;
  }
  async finish(input: Parameters<GrantModelCallRepository["finish"]>[0]) {
    const row = this.rows.get(input.callId)!;
    const updated = { ...row, ...input } as GrantModelCallAttempt;
    this.rows.set(input.callId, updated);
    return updated;
  }
  async listByTrace(_documentId: string, traceId: string) {
    return [...this.rows.values()].filter((row) => row.traceId === traceId);
  }
}

const ownerId = randomUUID();
const envelope: AiUsageEnvelope = {
  usageEventId: randomUUID(),
  billingOperationId: randomUUID(),
  operation: AI_OPERATIONS.chat.conversation,
  provider: "openai",
  modelId: "test-model",
  attemptNumber: 1,
  cacheHit: false,
  usage: [{ kind: "tokens", inputTokens: 100, cachedInputTokens: 20, outputTokens: 40, reasoningTokens: 10 }],
  occurredAt: new Date().toISOString(),
};

assert.equal(resolveAiBillingIntegrationMode(undefined), "disabled");
assert.throws(() => resolveAiBillingIntegrationMode("enforced"));

const disabledSink = new MemorySink();
await new AiUsageIntegration(disabledSink, "disabled").record(ownerId, envelope);
assert.equal(disabledSink.rows.length, 0);

const meteredSink = new MemorySink();
const integration = new AiUsageIntegration(meteredSink, "meter_only");
await integration.record(ownerId, envelope);
await integration.record(ownerId, envelope);
assert.equal(meteredSink.rows.length, 1, "usage event identity must be idempotent");

const calls = new MemoryGrantCalls();
const observed: unknown[] = [];
const ids = [randomUUID(), randomUUID()];
const executor = new GrantModelExecutor(
  calls,
  () => ids.shift()!,
  () => "2026-08-23T00:00:00.000Z",
  async (event) => { observed.push(event); },
);
const turnId = randomUUID();
await executor.execute({
  documentId: randomUUID(),
  turnId,
  inputHash: "a".repeat(64),
  policy: resolveGrantModelOperationPolicy({
    operation: AI_OPERATIONS.grant.editSessionTurn,
    configuredGrantModelId: "test-model",
  }),
  classifyFailure: () => "provider_unavailable",
  invoke: async () => ({
    value: "ok",
    outputHash: "b".repeat(64),
    usage: { inputTokens: 80, outputTokens: 20, reasoningTokens: 5 },
  }),
});
assert.equal(observed.length, 1);
assert.equal((observed[0] as { billingOperationId: string }).billingOperationId, turnId);

const root = new URL("../", import.meta.url);
const [chat, documentWorker, editService, migration, workflow] = await Promise.all([
  readFile(new URL("app/api/chat/route.ts", root), "utf8"),
  readFile(new URL("lib/document-v2-production/worker.ts", root), "utf8"),
  readFile(new URL("lib/grants/application/grant-ai-edit-session-service.ts", root), "utf8"),
  readFile(new URL("supabase/migrations/061_standardized_ai_usage_events.sql", root), "utf8"),
  readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
]);
assert.match(chat, /billingOperationId: chatBillingOperationId/);
assert.match(documentWorker, /usageIntegration\.record\(claimedJob\.ownerId/);
assert.match(editService, /usage: value\.usage/);
assert.match(migration, /standardized_usage JSONB/);
assert.match(workflow, /test:ai-billing-integration/);

console.log("AI billing integration contracts verified.");
