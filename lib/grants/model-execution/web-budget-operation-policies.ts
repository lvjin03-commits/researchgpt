import { AI_OPERATIONS, type RegisteredAiOperation } from "../../ai/operation-registry.ts";
import {
  GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION,
  GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION,
  GRANT_WEB_GAP_COMPARE_OPERATION,
  GRANT_WEB_NEXT_STEP_DECIDE_OPERATION,
  GRANT_WEB_QUERY_REWRITE_OPERATION,
  GRANT_WEB_SOURCE_ASSESS_OPERATION,
  resolveGrantModelOperationPolicy,
} from "./operation-registry.ts";

export const GRANT_WEB_BUDGET_POLICY_VERSION = "grant-web-user-budget-v1" as const;

export type GrantWebBudgetEnvelope = "decision" | "execution" | "delivery";
export type GrantWebBudgetOperationPolicy = {
  operation: RegisteredAiOperation;
  envelope: GrantWebBudgetEnvelope;
  maximumInputTokens: number;
  maximumOutputTokens: number;
  maximumToolCalls: number;
  maximumProviderAttempts: number;
  timeoutMilliseconds: number;
  maximumResults: number;
};

const modelPolicy = (operation: Parameters<typeof resolveGrantModelOperationPolicy>[0]["operation"]): GrantWebBudgetOperationPolicy => {
  const policy = resolveGrantModelOperationPolicy({ operation, configuredGrantModelId: "policy-bound-model" });
  return Object.freeze({
    operation,
    envelope: operation === GRANT_WEB_NEXT_STEP_DECIDE_OPERATION ? "decision"
      : operation === GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION || operation === GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION
        ? "delivery" : "execution",
    ...policy.executionLimits,
    maximumProviderAttempts: policy.maximumAttempts,
    maximumResults: 0,
  });
};

export const GRANT_WEB_BUDGET_OPERATION_POLICIES: Readonly<Record<string, GrantWebBudgetOperationPolicy>> = Object.freeze({
  next_step_decision: modelPolicy(GRANT_WEB_NEXT_STEP_DECIDE_OPERATION),
  query_rewrite: modelPolicy(GRANT_WEB_QUERY_REWRITE_OPERATION),
  search_query: Object.freeze({
    operation: AI_OPERATIONS.grant.webSearchQuery,
    envelope: "execution" as const,
    maximumInputTokens: 2_000,
    maximumOutputTokens: 600,
    maximumToolCalls: 1,
    maximumProviderAttempts: 1,
    timeoutMilliseconds: 45_000,
    maximumResults: 10,
  }),
  source_assessment: modelPolicy(GRANT_WEB_SOURCE_ASSESS_OPERATION),
  gap_comparison: modelPolicy(GRANT_WEB_GAP_COMPARE_OPERATION),
  answer_synthesis: modelPolicy(GRANT_WEB_ANSWER_SYNTHESIZE_OPERATION),
  existing_results_delivery: modelPolicy(GRANT_WEB_EXISTING_RESULTS_DELIVER_OPERATION),
});

export function getGrantWebBudgetOperationPolicy(key: keyof typeof GRANT_WEB_BUDGET_OPERATION_POLICIES) {
  return GRANT_WEB_BUDGET_OPERATION_POLICIES[key];
}

export function assertGrantWebPlannedCallWithinPolicy(input: {
  policy: GrantWebBudgetOperationPolicy;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  providerAttempts: number;
  timeoutMilliseconds: number;
  maximumResults?: number;
}): void {
  const integers = [input.inputTokens, input.outputTokens, input.toolCalls, input.providerAttempts, input.timeoutMilliseconds];
  if (integers.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("Planned call limits must be safe non-negative integers.");
  if (input.inputTokens > input.policy.maximumInputTokens) throw new Error("Planned input exceeds the Operation Policy.");
  if (input.outputTokens > input.policy.maximumOutputTokens) throw new Error("Planned output exceeds the Operation Policy.");
  if (input.toolCalls > input.policy.maximumToolCalls) throw new Error("Planned tool calls exceed the Operation Policy.");
  if (input.providerAttempts > input.policy.maximumProviderAttempts) throw new Error("Planned attempts exceed the Operation Policy.");
  if (input.timeoutMilliseconds > input.policy.timeoutMilliseconds) throw new Error("Planned timeout exceeds the Operation Policy.");
  if ((input.maximumResults ?? 0) > input.policy.maximumResults) throw new Error("Planned result count exceeds the Operation Policy.");
}
