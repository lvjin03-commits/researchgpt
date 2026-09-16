import assert from "node:assert/strict";
import {
  createGrantAssistantFailureReason,
  GRANT_ASSISTANT_FAILURE_REASON_CODES,
  GRANT_ASSISTANT_FAILURE_REASON_CONTRACT_VERSION,
  GRANT_ASSISTANT_FAILURE_REASON_DEFINITIONS,
  GrantAssistantFailureReasonSchema,
  GrantAssistantFailureSafeFactsSchema,
} from "../lib/grants/model-execution/assistant-failure-reasons.ts";

assert.equal(
  new Set(GRANT_ASSISTANT_FAILURE_REASON_CODES).size,
  GRANT_ASSISTANT_FAILURE_REASON_CODES.length,
  "Rule-level reason codes must be unique and stable.",
);

for (const reasonCode of GRANT_ASSISTANT_FAILURE_REASON_CODES) {
  const definition = GRANT_ASSISTANT_FAILURE_REASON_DEFINITIONS[reasonCode];
  assert.ok(definition.allowedStages.length > 0, `${reasonCode} must declare at least one legal stage.`);
  for (const stage of definition.allowedStages) {
    const reason = createGrantAssistantFailureReason({ reasonCode, stage });
    assert.equal(reason.contractVersion, GRANT_ASSISTANT_FAILURE_REASON_CONTRACT_VERSION);
    assert.equal(reason.component, definition.component);
    assert.equal(reason.category, definition.category);
    assert.equal(reason.stage, stage);
  }
}

const capacity = createGrantAssistantFailureReason({
  reasonCode: "budget.planning_required_context_exceeded",
  stage: "context_admission",
  safeFacts: { maximumInputTokens: 24_000, requiredInputTokens: 24_001,
    requestDispatched: false, usageKnown: true },
});
assert.equal(capacity.category, "planning_capacity_exceeded");
assert.equal(capacity.component, "context_budget");

assert.throws(() => GrantAssistantFailureReasonSchema.parse({
  ...capacity,
  category: "provider_unavailable",
}), /registered reason code/u, "A downstream caller cannot reinterpret the registered category.");

assert.throws(() => GrantAssistantFailureReasonSchema.parse({
  ...capacity,
  stage: "answer_generation",
}), /not valid for this reason code/u, "A reason cannot be assigned to an unrelated stage.");

assert.throws(() => GrantAssistantFailureSafeFactsSchema.parse({
  requiredInputTokens: 24_001,
  rawPrompt: "sensitive grant content",
}), /Unrecognized key/u, "Failure facts must reject free-form prompt or document content.");

assert.throws(() => GrantAssistantFailureSafeFactsSchema.parse({
  providerBody: { error: "secret" },
}), /Unrecognized key/u, "Failure facts must reject nested provider response bodies.");

console.log("Grant Assistant rule-level failure reason contract passed.");
