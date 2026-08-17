import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GrantModelExecutionError, GrantModelExecutor } from "../lib/grants/application/grant-model-executor.ts";
import { InMemoryGrantModelCallRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-model-call-repository.ts";
import { GRANT_ASSISTANT_CHAT_OPERATION, GRANT_EDIT_SESSION_TURN_OPERATION, resolveGrantModelOperationPolicy } from "../lib/grants/model-execution/operation-registry.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const documentId = randomUUID();
const policy = resolveGrantModelOperationPolicy({ operation: GRANT_EDIT_SESSION_TURN_OPERATION, configuredGrantModelId: "gpt-5.5" });
assert.equal(policy.provider, "openai");
assert.equal(policy.maximumAttempts, 2);
const assistantChatPolicy = resolveGrantModelOperationPolicy({ operation: GRANT_ASSISTANT_CHAT_OPERATION, configuredGrantModelId: "gpt-5.5" });
assert.equal(assistantChatPolicy.operation, "grant.assistant.chat");
assert.equal(assistantChatPolicy.policyVersion, "grant-assistant-chat-v1");
assert.equal(assistantChatPolicy.maximumAttempts, 2);

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
await assert.rejects(
  executor.execute({
    documentId, inputHash: hash("other-input"), policy,
    classifyFailure: () => "content_filtered",
    invoke: async () => { permanentCalls += 1; throw new Error("filtered"); },
  }),
  (error) => error instanceof GrantModelExecutionError && error.category === "content_filtered",
);
assert.equal(permanentCalls, 1, "non-retryable failures consume one provider attempt");

const unavailableRepository = new InMemoryGrantModelCallRepository();
unavailableRepository.start = async () => { throw new Error("telemetry unavailable"); };
let unloggedCalls = 0;
await assert.rejects(executor.execute.call(new GrantModelExecutor(unavailableRepository), {
  documentId, inputHash: hash("blocked-before-call"), policy,
  classifyFailure: () => "provider_unavailable",
  invoke: async () => { unloggedCalls += 1; return { value: "never", outputHash: hash("never") }; },
}), /telemetry unavailable/);
assert.equal(unloggedCalls, 0, "a model call cannot start without its durable started record");

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

console.log("Grant model execution foundation passed.");
