import { ResumableWebAnswerBudgetCoordinator } from "../../billing/application/resumable-web-answer-budget-coordinator.ts";
import {
  waiveDecisionEnvelopeForDelivery,
  type ResumableWebAnswerBudgetState,
} from "../../billing/domain/resumable-web-answer-budget.ts";
import {
  assertGrantWebPlannedCallWithinPolicy,
  getGrantWebBudgetOperationPolicy,
  type GrantWebBudgetOperationPolicy,
} from "../model-execution/web-budget-operation-policies.ts";

type ResearchBudgetPolicyKey = "next_step_decision" | "search_query" | "source_assessment"
  | "gap_comparison" | "existing_results_delivery";

export type GrantResearchPhaseQuote = {
  operation: GrantWebBudgetOperationPolicy["operation"];
  maximumChargePoints: number;
  pricePolicyVersion: string;
};

export type GrantResearchPhasePricingPort = {
  quote(input: { operation: GrantWebBudgetOperationPolicy["operation"]; policy: GrantWebBudgetOperationPolicy }): Promise<GrantResearchPhaseQuote>;
};

export type GrantResearchBudgetStateTransitionPort = {
  transition(previous: ResumableWebAnswerBudgetState, next: ResumableWebAnswerBudgetState): Promise<ResumableWebAnswerBudgetState>;
};

export class GrantResearchBudgetedWorkflow {
  private readonly dependencies: {
    coordinator: ResumableWebAnswerBudgetCoordinator;
    pricing: GrantResearchPhasePricingPort;
    stateTransitions: GrantResearchBudgetStateTransitionPort;
  };

  constructor(dependencies: GrantResearchBudgetedWorkflow["dependencies"]) {
    this.dependencies = dependencies;
  }

  async executePaidPhase<T>(input: {
    state: ResumableWebAnswerBudgetState;
    phaseId: string;
    policyKey: Exclude<ResearchBudgetPolicyKey, "existing_results_delivery">;
    plannedCall: {
      inputTokens: number;
      outputTokens: number;
      toolCalls: number;
      providerAttempts: number;
      timeoutMilliseconds: number;
      maximumResults?: number;
    };
    invoke: () => Promise<{ value: T; chargedPoints: number; checkpointArtifact?: unknown }>;
  }) {
    const policy = getGrantWebBudgetOperationPolicy(input.policyKey);
    assertGrantWebPlannedCallWithinPolicy({ policy, ...input.plannedCall });
    const quote = await this.dependencies.pricing.quote({ operation: policy.operation, policy });
    if (quote.operation !== policy.operation || !quote.pricePolicyVersion.trim()
      || !Number.isSafeInteger(quote.maximumChargePoints) || quote.maximumChargePoints <= 0) {
      throw new Error("The Point Billing Service returned an invalid research-phase quote.");
    }
    return this.dependencies.coordinator.executePhase({
      state: input.state,
      phaseId: input.phaseId,
      envelope: policy.envelope,
      maximumChargePoints: quote.maximumChargePoints,
      pricePolicyVersion: quote.pricePolicyVersion,
      invoke: input.invoke,
    });
  }

  async declineIncreaseAndDeliver<T>(input: {
    state: ResumableWebAnswerBudgetState;
    phaseId: string;
    plannedCall: {
      inputTokens: number;
      outputTokens: number;
      toolCalls: 0;
      providerAttempts: 1;
      timeoutMilliseconds: number;
    };
    invoke: () => Promise<{ value: T; chargedPoints: number; checkpointArtifact?: unknown }>;
  }) {
    if (input.state.status !== "awaiting_budget") throw new Error("Only a paused research task can decline an increase.");
    const policy = getGrantWebBudgetOperationPolicy("existing_results_delivery");
    assertGrantWebPlannedCallWithinPolicy({ policy, ...input.plannedCall });
    const quote = await this.dependencies.pricing.quote({ operation: policy.operation, policy });
    if (quote.operation !== policy.operation || quote.maximumChargePoints > input.state.deliveryHardMaximumPoints
      || quote.maximumChargePoints <= 0 || !Number.isSafeInteger(quote.maximumChargePoints)
      || !quote.pricePolicyVersion.trim()) {
      throw new Error("The protected delivery quote is invalid or exceeds its hard maximum.");
    }
    const deliveryReady = waiveDecisionEnvelopeForDelivery(input.state);
    const persisted = await this.dependencies.stateTransitions.transition(input.state, deliveryReady);
    return this.dependencies.coordinator.executePhase({
      state: persisted,
      phaseId: input.phaseId,
      envelope: "delivery",
      maximumChargePoints: quote.maximumChargePoints,
      pricePolicyVersion: quote.pricePolicyVersion,
      invoke: async () => {
        const result = await input.invoke();
        return { ...result, deliveryOutcome: "partial" as const };
      },
    });
  }
}
