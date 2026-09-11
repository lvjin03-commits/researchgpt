import type { RegisteredAiOperation } from "../../ai/operation-registry.ts";
import { ResumableWebAnswerBudgetCoordinator } from "../../billing/application/resumable-web-answer-budget-coordinator.ts";
import type { ResumableWebAnswerBudgetState } from "../../billing/domain/resumable-web-answer-budget.ts";
import {
  assertGrantWebPlannedCallWithinPolicy,
  GRANT_WEB_BUDGET_OPERATION_POLICIES,
  getGrantWebBudgetOperationPolicy,
} from "../model-execution/web-budget-operation-policies.ts";

export type GrantWebBudgetOperationKey = keyof typeof GRANT_WEB_BUDGET_OPERATION_POLICIES;

export type GrantWebPhaseQuote = Readonly<{
  operation: RegisteredAiOperation;
  pricePolicyVersion: string;
  maximumChargePoints: number;
}>;

export type GrantWebPlannedCall = Readonly<{
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  providerAttempts: number;
  timeoutMilliseconds: number;
  maximumResults?: number;
}>;

export class GrantWebBudgetedPhaseOrchestrator {
  private readonly budget: ResumableWebAnswerBudgetCoordinator;

  constructor(budget: ResumableWebAnswerBudgetCoordinator) {
    this.budget = budget;
  }

  async execute<T>(input: {
    state: ResumableWebAnswerBudgetState;
    phaseId: string;
    operationKey: GrantWebBudgetOperationKey;
    quote: GrantWebPhaseQuote;
    plannedCall: GrantWebPlannedCall;
    invoke: () => Promise<{ value: T; chargedPoints: number; deliveryOutcome?: "complete" | "partial";
      checkpointArtifact?: unknown }>;
  }) {
    const policy = getGrantWebBudgetOperationPolicy(input.operationKey);
    if (input.quote.operation !== policy.operation) {
      throw new Error("The phase quote does not belong to the selected Operation Policy.");
    }
    if (!input.quote.pricePolicyVersion.trim()) throw new Error("The phase quote requires a price policy version.");
    if (!Number.isSafeInteger(input.quote.maximumChargePoints) || input.quote.maximumChargePoints <= 0) {
      throw new Error("The phase quote requires a positive safe maximum charge.");
    }
    assertGrantWebPlannedCallWithinPolicy({ policy, ...input.plannedCall });
    return this.budget.executePhase({
      state: input.state,
      phaseId: input.phaseId,
      envelope: policy.envelope,
      maximumChargePoints: input.quote.maximumChargePoints,
      pricePolicyVersion: input.quote.pricePolicyVersion,
      invoke: input.invoke,
    });
  }
}
