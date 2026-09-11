import { AI_OPERATIONS, type GrantAiOperation } from "../../ai/operation-registry.ts";

export const GRANT_EDIT_SESSION_TURN_OPERATION = AI_OPERATIONS.grant.editSessionTurn;
export const GRANT_EDIT_SESSION_TURN_POLICY_VERSION = "grant-edit-session-turn-v1" as const;
export const GRANT_ASSISTANT_CHAT_OPERATION = AI_OPERATIONS.grant.assistantChat;
export const GRANT_ASSISTANT_CHAT_POLICY_VERSION = "grant-assistant-chat-v1" as const;
export const GRANT_WEB_QUERY_REWRITE_OPERATION = AI_OPERATIONS.grant.webQueryRewrite;
export const GRANT_WEB_QUERY_REWRITE_POLICY_VERSION = "grant-web-query-rewrite-v1" as const;
export const GRANT_WEB_SOURCE_ASSESS_OPERATION = AI_OPERATIONS.grant.webSourceAssess;
export const GRANT_WEB_SOURCE_ASSESS_POLICY_VERSION = "grant-web-source-assess-v1" as const;
export const GRANT_WEB_GAP_COMPARE_OPERATION = AI_OPERATIONS.grant.webGapCompare;
export const GRANT_WEB_GAP_COMPARE_POLICY_VERSION = "grant-web-gap-compare-v1" as const;
export const GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION = AI_OPERATIONS.grant.webAnswerSynthesize;
export const GRANT_WEB_ANSWER_SYNTHESIZE_POLICY_VERSION = "grant-web-answer-synthesize-v1" as const;
export const GRANT_WEB_NEXT_STEP_DECIDE_OPERATION = AI_OPERATIONS.grant.webNextStepDecide;
export const GRANT_WEB_NEXT_STEP_DECIDE_POLICY_VERSION = "grant-web-next-step-decide-v1" as const;
export const GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION = AI_OPERATIONS.grant.webExistingResultsDeliver;
export const GRANT_WEB_EXISTING_RESULTS_DELIVER_POLICY_VERSION = "grant-web-existing-results-deliver-v1" as const;

export type GrantModelOperation = Extract<GrantAiOperation,
  typeof GRANT_EDIT_SESSION_TURN_OPERATION | typeof GRANT_ASSISTANT_CHAT_OPERATION |
  typeof GRANT_WEB_QUERY_REWRITE_OPERATION | typeof GRANT_WEB_SOURCE_ASSESS_OPERATION | typeof GRANT_WEB_GAP_COMPARE_OPERATION | typeof GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION |
  typeof GRANT_WEB_NEXT_STEP_DECIDE_OPERATION | typeof GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION>;
export type GrantModelOperationPolicyVersion = typeof GRANT_EDIT_SESSION_TURN_POLICY_VERSION |
  typeof GRANT_ASSISTANT_CHAT_POLICY_VERSION | typeof GRANT_WEB_SOURCE_ASSESS_POLICY_VERSION | typeof GRANT_WEB_GAP_COMPARE_POLICY_VERSION |
  typeof GRANT_WEB_ANSWER_SYNTHESIZE_POLICY_VERSION | typeof GRANT_WEB_QUERY_REWRITE_POLICY_VERSION |
  typeof GRANT_WEB_NEXT_STEP_DECIDE_POLICY_VERSION | typeof GRANT_WEB_EXISTING_RESULTS_DELIVER_POLICY_VERSION;

export type GrantModelOperationExecutionLimits = {
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumToolCalls: number;
  timeoutMilliseconds: number;
};

export type GrantModelFailureCategory =
  | "structured_output_invalid"
  | "structured_reference_invalid"
  | "output_truncated"
  | "content_filtered"
  | "provider_refusal"
  | "provider_rate_limited"
  | "provider_transient_error"
  | "provider_contract_error"
  | "provider_unavailable"
  | "evidence_authorization_changed"
  | "figure_authorization_changed"
  | "web_source_unavailable"
  | "candidate_base_invalid"
  | "unknown_provider_failure";

export type GrantModelOperationPolicy = {
  operation: GrantModelOperation;
  policyVersion: GrantModelOperationPolicyVersion;
  provider: "openai";
  modelId: string;
  maximumAttempts: 1 | 2;
  executionLimits: GrantModelOperationExecutionLimits;
  retryableCategories: ReadonlySet<GrantModelFailureCategory>;
};

export function resolveGrantModelOperationPolicy(input: {
  operation: GrantModelOperation;
  configuredGrantModelId: string;
}): GrantModelOperationPolicy {
  const modelId = input.configuredGrantModelId.trim();
  if (!modelId) throw new Error("Grant AI model configuration is empty.");
  if (input.operation !== GRANT_ASSISTANT_CHAT_OPERATION && input.operation !== GRANT_EDIT_SESSION_TURN_OPERATION &&
    input.operation !== GRANT_WEB_QUERY_REWRITE_OPERATION && input.operation !== GRANT_WEB_SOURCE_ASSESS_OPERATION && input.operation !== GRANT_WEB_GAP_COMPARE_OPERATION && input.operation !== GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION &&
    input.operation !== GRANT_WEB_NEXT_STEP_DECIDE_OPERATION && input.operation !== GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION) {
    throw new Error(`Grant model operation is not registered: ${String(input.operation)}`);
  }
  return Object.freeze({
    operation: input.operation,
    policyVersion: input.operation === GRANT_ASSISTANT_CHAT_OPERATION ? GRANT_ASSISTANT_CHAT_POLICY_VERSION
      : input.operation === GRANT_WEB_QUERY_REWRITE_OPERATION ? GRANT_WEB_QUERY_REWRITE_POLICY_VERSION
      : input.operation === GRANT_WEB_SOURCE_ASSESS_OPERATION ? GRANT_WEB_SOURCE_ASSESS_POLICY_VERSION
      : input.operation === GRANT_WEB_GAP_COMPARE_OPERATION ? GRANT_WEB_GAP_COMPARE_POLICY_VERSION
      : input.operation === GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION ? GRANT_WEB_ANSWER_SYNTHESIZE_POLICY_VERSION
      : input.operation === GRANT_WEB_NEXT_STEP_DECIDE_OPERATION ? GRANT_WEB_NEXT_STEP_DECIDE_POLICY_VERSION
      : input.operation === GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION ? GRANT_WEB_EXISTING_RESULTS_DELIVER_POLICY_VERSION
      : GRANT_EDIT_SESSION_TURN_POLICY_VERSION,
    provider: "openai",
    modelId,
    maximumAttempts: input.operation === GRANT_WEB_NEXT_STEP_DECIDE_OPERATION || input.operation === GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION ? 1 : 2,
    executionLimits: input.operation === GRANT_WEB_NEXT_STEP_DECIDE_OPERATION
      ? { maximumInputTokens: 4_000, maximumOutputTokens: 300, maximumToolCalls: 0, timeoutMilliseconds: 30_000 }
      : input.operation === GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION
        ? { maximumInputTokens: 16_000, maximumOutputTokens: 1_600, maximumToolCalls: 0, timeoutMilliseconds: 90_000 }
        : input.operation === GRANT_WEB_QUERY_REWRITE_OPERATION
          ? { maximumInputTokens: 4_000, maximumOutputTokens: 300, maximumToolCalls: 0, timeoutMilliseconds: 45_000 }
          : input.operation === GRANT_WEB_SOURCE_ASSESS_OPERATION
            ? { maximumInputTokens: 12_000, maximumOutputTokens: 1_600, maximumToolCalls: 0, timeoutMilliseconds: 90_000 }
            : input.operation === GRANT_WEB_GAP_COMPARE_OPERATION
              ? { maximumInputTokens: 16_000, maximumOutputTokens: 2_000, maximumToolCalls: 0, timeoutMilliseconds: 120_000 }
            : input.operation === GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION
              ? { maximumInputTokens: 16_000, maximumOutputTokens: 2_400, maximumToolCalls: 0, timeoutMilliseconds: 120_000 }
              : { maximumInputTokens: 24_000, maximumOutputTokens: 4_000, maximumToolCalls: 0, timeoutMilliseconds: 120_000 },
    retryableCategories: new Set<GrantModelFailureCategory>(input.operation === GRANT_WEB_NEXT_STEP_DECIDE_OPERATION || input.operation === GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION ? [] : [
      "structured_output_invalid",
      "structured_reference_invalid",
      "output_truncated",
      "provider_rate_limited",
      "provider_transient_error",
    ]),
  });
}

export function grantModelRetryPurpose(category: GrantModelFailureCategory) {
  if (category === "structured_output_invalid" || category === "structured_reference_invalid") return "schema_repair" as const;
  if (category === "output_truncated") return "capacity_retry" as const;
  return "transient_retry" as const;
}
