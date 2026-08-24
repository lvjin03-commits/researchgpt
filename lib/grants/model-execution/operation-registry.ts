import { AI_OPERATIONS, type GrantAiOperation } from "../../ai/operation-registry.ts";

export const GRANT_EDIT_SESSION_TURN_OPERATION = AI_OPERATIONS.grant.editSessionTurn;
export const GRANT_EDIT_SESSION_TURN_POLICY_VERSION = "grant-edit-session-turn-v1" as const;
export const GRANT_ASSISTANT_CHAT_OPERATION = AI_OPERATIONS.grant.assistantChat;
export const GRANT_ASSISTANT_CHAT_POLICY_VERSION = "grant-assistant-chat-v1" as const;

export type GrantModelOperation = Extract<GrantAiOperation,
  typeof GRANT_EDIT_SESSION_TURN_OPERATION | typeof GRANT_ASSISTANT_CHAT_OPERATION>;
export type GrantModelOperationPolicyVersion = typeof GRANT_EDIT_SESSION_TURN_POLICY_VERSION | typeof GRANT_ASSISTANT_CHAT_POLICY_VERSION;

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
  maximumAttempts: 2;
  retryableCategories: ReadonlySet<GrantModelFailureCategory>;
};

export function resolveGrantModelOperationPolicy(input: {
  operation: GrantModelOperation;
  configuredGrantModelId: string;
}): GrantModelOperationPolicy {
  const modelId = input.configuredGrantModelId.trim();
  if (!modelId) throw new Error("Grant AI model configuration is empty.");
  if (input.operation !== GRANT_ASSISTANT_CHAT_OPERATION && input.operation !== GRANT_EDIT_SESSION_TURN_OPERATION) {
    throw new Error(`Grant model operation is not registered: ${String(input.operation)}`);
  }
  return Object.freeze({
    operation: input.operation,
    policyVersion: input.operation === GRANT_ASSISTANT_CHAT_OPERATION
      ? GRANT_ASSISTANT_CHAT_POLICY_VERSION
      : GRANT_EDIT_SESSION_TURN_POLICY_VERSION,
    provider: "openai",
    modelId,
    maximumAttempts: 2,
    retryableCategories: new Set<GrantModelFailureCategory>([
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
