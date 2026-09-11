import {
  admitResumableWebAnswerPhase,
  releaseFailedResumableWebAnswerPhase,
  settleResumableWebAnswerPhase,
  type ResumableWebAnswerBudgetEnvelope,
  type ResumableWebAnswerBudgetState,
} from "../domain/resumable-web-answer-budget.ts";

export type WebAnswerPhaseReservationPort = {
  reserve(input: { state: ResumableWebAnswerBudgetState; phaseId: string; maximumChargePoints: number;
    pricePolicyVersion: string }): Promise<void>;
  settle(input: { state: ResumableWebAnswerBudgetState; nextState: ResumableWebAnswerBudgetState;
    phaseId: string; chargedPoints: number; checkpointArtifact?: unknown }): Promise<void>;
  release(input: { state: ResumableWebAnswerBudgetState; nextState: ResumableWebAnswerBudgetState;
    phaseId: string }): Promise<void>;
};

export class ResumableWebAnswerBudgetCoordinator {
  private readonly reservations: WebAnswerPhaseReservationPort;

  constructor(reservations: WebAnswerPhaseReservationPort) {
    this.reservations = reservations;
  }

  async executePhase<T>(input: {
    state: ResumableWebAnswerBudgetState;
    phaseId: string;
    envelope: ResumableWebAnswerBudgetEnvelope;
    maximumChargePoints: number;
    pricePolicyVersion: string;
    invoke: () => Promise<{ value: T; chargedPoints: number; deliveryOutcome?: "complete" | "partial";
      checkpointArtifact?: unknown }>;
  }): Promise<
    | { status: "awaiting_budget"; state: ResumableWebAnswerBudgetState; requiredAdditionalPoints: number }
    | { status: "completed"; state: ResumableWebAnswerBudgetState; value: T }
  > {
    const admission = admitResumableWebAnswerPhase(input);
    if (admission.decision === "awaiting_budget") return { status: "awaiting_budget", ...admission };

    // The reservation port will become one atomic state+ledger RPC in Step 4.
    // Provider invocation is deliberately sequenced strictly after it succeeds.
    await this.reservations.reserve({ state: admission.state, phaseId: input.phaseId,
      maximumChargePoints: input.maximumChargePoints, pricePolicyVersion: input.pricePolicyVersion });
    let result: Awaited<ReturnType<typeof input.invoke>>;
    try {
      result = await input.invoke();
    } catch (error) {
      const nextState = releaseFailedResumableWebAnswerPhase({ state: admission.state, phaseId: input.phaseId });
      await this.reservations.release({ state: admission.state, nextState, phaseId: input.phaseId });
      throw error;
    }
    // Validate the proposed charge and transition before touching the ledger. If
    // ledger settlement has an unknown outcome, never compensate with release.
    let settledState: ResumableWebAnswerBudgetState;
    try {
      settledState = settleResumableWebAnswerPhase({
        state: admission.state, phaseId: input.phaseId, chargedPoints: result.chargedPoints,
        deliveryOutcome: result.deliveryOutcome,
      });
    } catch (error) {
      const nextState = releaseFailedResumableWebAnswerPhase({ state: admission.state, phaseId: input.phaseId });
      await this.reservations.release({ state: admission.state, nextState, phaseId: input.phaseId });
      throw error;
    }
    await this.reservations.settle({ state: admission.state, nextState: settledState, phaseId: input.phaseId,
      chargedPoints: result.chargedPoints, checkpointArtifact: result.checkpointArtifact });
    return { status: "completed", value: result.value, state: settledState };
  }
}
