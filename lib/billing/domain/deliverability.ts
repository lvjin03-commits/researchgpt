import { AI_OPERATIONS, REGISTERED_AI_OPERATIONS, type RegisteredAiOperation } from "../../ai/operation-registry.ts";

export const BILLING_TERMINAL_STATES = Object.freeze([
  "delivered", "partially_delivered", "succeeded_internal_only",
  "structured_output_invalid", "structured_reference_invalid", "output_truncated",
  "content_filtered", "provider_refusal", "provider_rate_limited",
  "provider_timeout", "provider_transient_error", "provider_unavailable",
  "stale_completed", "unable_to_reverify", "ambiguous_match", "blocked",
] as const);
export type BillingTerminalState = typeof BILLING_TERMINAL_STATES[number];
export type BillingDecision = "charge_delivered_usage" | "charge_delivered_bundles" | "release";

export type BillingOperationContract = {
  operation: RegisteredAiOperation;
  contractVersion: string;
  bundleKeys: readonly string[];
  deliverabilityMatrix: Readonly<Record<BillingTerminalState, BillingDecision>>;
};

const DEFAULT_MATRIX: Readonly<Record<BillingTerminalState, BillingDecision>> = Object.freeze({
  delivered: "charge_delivered_usage",
  partially_delivered: "charge_delivered_bundles",
  succeeded_internal_only: "release",
  structured_output_invalid: "release",
  structured_reference_invalid: "release",
  output_truncated: "release",
  content_filtered: "release",
  provider_refusal: "release",
  provider_rate_limited: "release",
  provider_timeout: "release",
  provider_transient_error: "release",
  provider_unavailable: "release",
  stale_completed: "release",
  unable_to_reverify: "release",
  ambiguous_match: "release",
  blocked: "release",
});

const contracts = new Map<RegisteredAiOperation, BillingOperationContract>();
for (const operation of REGISTERED_AI_OPERATIONS) {
  contracts.set(operation, Object.freeze({ operation, contractVersion: "billing-deliverability-v1", bundleKeys: Object.freeze(["result"]), deliverabilityMatrix: DEFAULT_MATRIX }));
}
contracts.set(AI_OPERATIONS.grant.editSessionTurn, Object.freeze({
  operation: AI_OPERATIONS.grant.editSessionTurn,
  contractVersion: "grant-edit-turn-deliverability-v1",
  bundleKeys: Object.freeze(["single_edit_turn"]),
  deliverabilityMatrix: DEFAULT_MATRIX,
}));
contracts.set(AI_OPERATIONS.grant.diagnosticSemantic, Object.freeze({
  operation: AI_OPERATIONS.grant.diagnosticSemantic,
  contractVersion: "grant-diagnostic-deliverability-v1",
  bundleKeys: Object.freeze(["scientific_review_bundle", "narrative_review_bundle"]),
  deliverabilityMatrix: DEFAULT_MATRIX,
}));

export function getBillingOperationContract(operation: RegisteredAiOperation): BillingOperationContract {
  const contract = contracts.get(operation);
  if (!contract) throw new Error(`Billing operation contract is missing: ${operation}`);
  return contract;
}

export function resolveBillingDecision(input: { operation: RegisteredAiOperation; terminalState: string }): { decision: BillingDecision; unknownState: boolean } {
  const contract = getBillingOperationContract(input.operation);
  if (!(BILLING_TERMINAL_STATES as readonly string[]).includes(input.terminalState)) {
    return { decision: "release", unknownState: true };
  }
  return { decision: contract.deliverabilityMatrix[input.terminalState as BillingTerminalState], unknownState: false };
}
