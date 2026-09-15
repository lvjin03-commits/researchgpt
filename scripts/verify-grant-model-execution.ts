import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GrantModelExecutionError, GrantModelExecutor } from "../lib/grants/application/grant-model-executor.ts";
import { InMemoryGrantModelCallRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-model-call-repository.ts";
import { GRANT_ASSISTANT_CHAT_OPERATION, GRANT_EDIT_SESSION_TURN_OPERATION, resolveGrantModelOperationPolicy } from "../lib/grants/model-execution/operation-registry.ts";
import { GrantAssistantModelError } from "../lib/grants/ports/grant-assistant-model.ts";
import { presentGrantModelFailure } from "../lib/grants/application/grant-model-failure-presentation.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const documentId = randomUUID();
const policy = resolveGrantModelOperationPolicy({ operation: GRANT_EDIT_SESSION_TURN_OPERATION, configuredGrantModelId: "gpt-5.5" });
assert.equal(policy.provider, "openai");
assert.equal(policy.maximumAttempts, 2);
const assistantChatPolicy = resolveGrantModelOperationPolicy({ operation: GRANT_ASSISTANT_CHAT_OPERATION, configuredGrantModelId: "gpt-5.5" });
assert.equal(assistantChatPolicy.operation, "grant.assistant.chat");
assert.equal(assistantChatPolicy.policyVersion, "grant-assistant-chat-v1");
assert.equal(assistantChatPolicy.maximumAttempts, 2);
assert.deepEqual(assistantChatPolicy.assistantContextLimits, {
  semanticPlanning: { maximumInputTokens: 24_000, maximumOutputTokens: 700 },
  groundedAnswer: { maximumInputTokens: 24_000, maximumOutputTokens: 2_400 },
  fullDocumentReview: { maximumUnitInputTokens: 12_000, maximumUnitOutputTokens: 800,
    maximumSynthesisInputTokens: 16_000, maximumSynthesisOutputTokens: 2_400,
    maximumUnits: 12, maximumSectionsPerUnit: 4 },
});
assert.deepEqual(presentGrantModelFailure({ category: "provider_rate_limited" }), {
  status: 429, retryable: true, message: "当前 AI 请求较多，供应商触发限流，请稍后重试。" });
assert.match(presentGrantModelFailure({ category: "output_truncated", failureStage: "memory_build" }).message,
  /全文记忆生成达到输出上限/u);
assert.match(presentGrantModelFailure({ category: "output_truncated", failureStage: "semantic_planning" }).message,
  /尚未进入回答生成/u);
assert.match(presentGrantModelFailure({ category: "output_truncated", failureStage: "answer_generation" }).message,
  /没有展示或保存不完整回答/u);
assert.match(presentGrantModelFailure({ category: "answer_capacity_exceeded" }).message, /即使分层后/u);
assert.doesNotMatch(presentGrantModelFailure({ category: "internal_contract_error" }).message,
  /AI 服务暂时不可用/u);

const repository = new InMemoryGrantModelCallRepository();
const executor = new GrantModelExecutor(repository);
let calls = 0;
const recovered = await executor.execute({
  documentId, inputHash: hash("safe-structured-input"), policy,
  classifyFailure: (error) => error instanceof Error && error.message === "bad schema" ? "structured_output_invalid" : "provider_unavailable",
  invoke: async ({ attemptNumber, attemptPurpose }) => {
    calls += 1;
    if (attemptNumber === 1) throw new Error("bad schema");
    assert.equal(attemptPurpose, "schema_repair");
    return { value: "candidate", outputHash: hash("candidate"), providerRequestId: "req_test", usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 2 } };
  },
});
assert.equal(recovered.value, "candidate");
assert.equal(recovered.attempts, 2);
assert.equal(calls, 2);
const attempts = await repository.listByTrace(documentId, recovered.traceId);
assert.deepEqual(attempts.map((attempt) => attempt.status), ["failed", "succeeded"]);
assert.deepEqual(attempts.map((attempt) => attempt.attemptPurpose), ["initial", "schema_repair"]);
assert.equal(attempts[1]?.inputTokens, 10);

let permanentCalls = 0;
let permanentTraceId = "";
await assert.rejects(
  executor.execute({
    documentId, inputHash: hash("other-input"), policy,
    traceId: permanentTraceId = randomUUID(),
    classifyFailure: (error) => error instanceof GrantAssistantModelError ? error.category : "provider_unavailable",
    invoke: async () => { permanentCalls += 1; throw new GrantAssistantModelError("content_filtered", "filtered", {
      providerRequestId: "req_filtered", providerRequestIds: ["req_prior", "req_filtered"],
      usage: { inputTokens: 31, outputTokens: 7, reasoningTokens: 2 },
      failureStage: "answer_generation", requestDispatched: true, usageKnown: true,
    }); },
  }),
  (error) => error instanceof GrantModelExecutionError && error.category === "content_filtered",
);
assert.equal(permanentCalls, 1, "non-retryable failures consume one provider attempt");
const failedAttempts = await repository.listByTrace(documentId, permanentTraceId);
assert.deepEqual(failedAttempts.map(({ providerRequestId, inputTokens, outputTokens, reasoningTokens }) => ({
  providerRequestId, inputTokens, outputTokens, reasoningTokens,
})), [{ providerRequestId: "req_filtered", inputTokens: 31, outputTokens: 7, reasoningTokens: 2 }],
"A provider-completed failure must retain its factual request ID and token usage in model-call telemetry.");
assert.deepEqual(failedAttempts[0]?.providerRequestIds, ["req_prior", "req_filtered"]);
assert.equal(failedAttempts[0]?.failureStage, "answer_generation");
assert.equal(failedAttempts[0]?.requestDispatched, true);
assert.equal(failedAttempts[0]?.usageKnown, true);

const unavailableRepository = new InMemoryGrantModelCallRepository();
unavailableRepository.start = async () => { throw new Error("telemetry unavailable"); };
let unloggedCalls = 0;
await assert.rejects(executor.execute.call(new GrantModelExecutor(unavailableRepository), {
  documentId, inputHash: hash("blocked-before-call"), policy,
  classifyFailure: () => "provider_unavailable",
  invoke: async () => { unloggedCalls += 1; return { value: "never", outputHash: hash("never") }; },
}), /telemetry unavailable/);
assert.equal(unloggedCalls, 0, "a model call cannot start without its durable started record");

const capacityRepository = new InMemoryGrantModelCallRepository();
const capacityTraceId = randomUUID();
await assert.rejects(new GrantModelExecutor(capacityRepository).execute({
  documentId, traceId: capacityTraceId, inputHash: hash("capacity-rejected-before-answer"),
  policy: assistantChatPolicy,
  classifyFailure: (error) => error instanceof GrantAssistantModelError ? error.category : "internal_contract_error",
  invoke: async () => { throw new GrantAssistantModelError("answer_capacity_exceeded", "too large", {
    failureStage: "context_admission", requestDispatched: false, usageKnown: true,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  }); },
}), (error) => error instanceof GrantModelExecutionError
  && error.category === "answer_capacity_exceeded"
  && error.requestDispatched === false
  && error.usageKnown === true);
const capacityAttempts = await capacityRepository.listByTrace(documentId, capacityTraceId);
assert.equal(capacityAttempts.length, 1);
assert.equal(capacityAttempts[0]?.failureStage, "context_admission");
assert.equal(capacityAttempts[0]?.requestDispatched, false);
assert.equal(capacityAttempts[0]?.usageKnown, true);

const completionFailureRepository = new InMemoryGrantModelCallRepository();
const originalFinish = completionFailureRepository.finish.bind(completionFailureRepository);
completionFailureRepository.finish = async (input) => {
  if (input.status === "succeeded") throw new Error("completion telemetry unavailable");
  return originalFinish(input);
};
let successfulProviderCalls = 0;
await assert.rejects(new GrantModelExecutor(completionFailureRepository).execute({
  documentId, inputHash: hash("successful-but-unlogged"), policy,
  classifyFailure: () => "provider_transient_error",
  invoke: async () => { successfulProviderCalls += 1; return { value: "result", outputHash: hash("result") }; },
}), /completion telemetry unavailable/);
assert.equal(successfulProviderCalls, 1, "completion logging failure must not repeat a successful provider call");

const migration = await readFile(new URL("../supabase/migrations/052_grant_model_call_observability.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.grant_model_calls/);
assert.match(migration, /UNIQUE \(trace_id, attempt_number\)/);
assert.match(migration, /REVOKE ALL ON TABLE public\.grant_model_calls FROM PUBLIC, anon, authenticated/);
assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|EXECUTE)[^;]* TO authenticated/);
assert.doesNotMatch(migration, /prompt|excerpt|candidate_text|response_text/i, "model telemetry must not persist sensitive content");
const stageMigration = await readFile(new URL("../supabase/migrations/073_grant_assistant_context_execution_telemetry.sql", import.meta.url), "utf8");
assert.match(stageMigration, /failure_stage TEXT/);
assert.match(stageMigration, /request_dispatched BOOLEAN NOT NULL DEFAULT FALSE/);
assert.match(stageMigration, /usage_known BOOLEAN NOT NULL DEFAULT FALSE/);
assert.match(stageMigration, /provider_request_ids TEXT\[\]/);
assert.doesNotMatch(stageMigration, /prompt|excerpt|candidate_text|response_text/i,
  "stage telemetry must not persist sensitive model content");

console.log("Grant model execution foundation passed.");
