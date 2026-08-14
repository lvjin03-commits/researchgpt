export const GRANT_EDIT_SESSION_TURN_OPERATION = "grant.edit_session.turn" as const;
export const GRANT_EDIT_SESSION_TURN_POLICY_VERSION = "grant-edit-session-turn-v1" as const;

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
  operation: typeof GRANT_EDIT_SESSION_TURN_OPERATION;
  policyVersion: typeof GRANT_EDIT_SESSION_TURN_POLICY_VERSION;
  provider: "openai";
  modelId: string;
  maximumAttempts: 2;
  retryableCategories: ReadonlySet<GrantModelFailureCategory>;
};

export function resolveGrantModelOperationPolicy(input: {
  operation: typeof GRANT_EDIT_SESSION_TURN_OPERATION;
  configuredGrantModelId: string;
}): GrantModelOperationPolicy {
  const modelId = input.configuredGrantModelId.trim();
  if (!modelId) throw new Error("Grant AI model configuration is empty.");
  return Object.freeze({
    operation: input.operation,
    policyVersion: GRANT_EDIT_SESSION_TURN_POLICY_VERSION,
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

