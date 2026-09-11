import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebAnswerPhaseReservationPort } from "../../application/resumable-web-answer-budget-coordinator.ts";
import { ResumableWebAnswerBudgetStateSchema, type ResumableWebAnswerBudgetState } from "../../domain/resumable-web-answer-budget.ts";

function assertRpc(error: { message: string } | null): void {
  if (error) throw new Error(`Resumable web-answer budget RPC failed: ${error.message}`);
}

export class SupabaseResumableWebAnswerBudgetRepository implements WebAnswerPhaseReservationPort {
  constructor(private readonly client: SupabaseClient, private readonly ownerId: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly reservationTtlMs = 48 * 60 * 60 * 1000) {}

  async create(state: ResumableWebAnswerBudgetState,
    checkpoint: unknown): Promise<ResumableWebAnswerBudgetState> {
    const now = this.now();
    const { data, error } = await this.client.rpc("create_grant_web_answer_budget", {
      p_owner_id: state.ownerId, p_state: state, p_checkpoint: checkpoint,
      p_expires_at: new Date(Date.parse(now) + this.reservationTtlMs).toISOString(), p_now: now,
    });
    assertRpc(error);
    return ResumableWebAnswerBudgetStateSchema.parse(data);
  }

  async get(budgetId: string) {
    const { data, error } = await this.client.rpc("get_grant_web_answer_budget", {
      p_owner_id: this.ownerId, p_budget_id: budgetId,
    });
    assertRpc(error);
    if (!data) return null;
    const value = data as { state: unknown; checkpoint: unknown };
    return { state: ResumableWebAnswerBudgetStateSchema.parse(value.state), checkpoint: value.checkpoint };
  }

  async getLatestPausedForDocument(documentId: string) {
    const { data, error } = await this.client.from("grant_web_answer_budgets")
      .select("state,checkpoint")
      .eq("owner_id", this.ownerId)
      .eq("document_id", documentId)
      .eq("status", "awaiting_budget")
      .gt("expires_at", this.now())
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assertRpc(error);
    return data ? { state: ResumableWebAnswerBudgetStateSchema.parse(data.state), checkpoint: data.checkpoint } : null;
  }

  async transition(previous: ResumableWebAnswerBudgetState,
    next: ResumableWebAnswerBudgetState): Promise<ResumableWebAnswerBudgetState> {
    const { data, error } = await this.client.rpc("transition_grant_web_answer_budget", {
      p_owner_id: previous.ownerId, p_budget_id: previous.budgetId,
      p_expected_version: previous.version, p_next_state: next, p_now: this.now(),
    });
    assertRpc(error);
    return ResumableWebAnswerBudgetStateSchema.parse(data);
  }

  async authorizeIncrease(previous: ResumableWebAnswerBudgetState, authorizationId: string,
    additionalPoints: number, next: ResumableWebAnswerBudgetState): Promise<ResumableWebAnswerBudgetState> {
    const { data, error } = await this.client.rpc("authorize_grant_web_answer_budget_increase", {
      p_owner_id: previous.ownerId, p_budget_id: previous.budgetId,
      p_expected_version: previous.version, p_authorization_id: authorizationId,
      p_additional_points: additionalPoints, p_next_state: next, p_now: this.now(),
    });
    assertRpc(error);
    return ResumableWebAnswerBudgetStateSchema.parse(data);
  }

  async reserve(input: Parameters<WebAnswerPhaseReservationPort["reserve"]>[0]): Promise<void> {
    const now = this.now();
    const { error } = await this.client.rpc("reserve_grant_web_answer_phase", {
      p_owner_id: input.state.ownerId, p_budget_id: input.state.budgetId,
      p_expected_version: input.state.version - 1, p_phase_id: input.phaseId,
      p_maximum_charge_points: input.maximumChargePoints,
      p_price_policy_version: input.pricePolicyVersion,
      p_expires_at: new Date(Date.parse(now) + this.reservationTtlMs).toISOString(),
      p_next_state: input.state, p_now: now,
    });
    assertRpc(error);
  }

  async settle(input: Parameters<WebAnswerPhaseReservationPort["settle"]>[0]): Promise<void> {
    const { error } = await this.client.rpc("settle_grant_web_answer_phase", {
      p_owner_id: input.state.ownerId, p_budget_id: input.state.budgetId,
      p_expected_version: input.state.version, p_phase_id: input.phaseId,
      p_settled_points: input.chargedPoints, p_next_state: input.nextState,
      p_checkpoint: input.checkpointArtifact ?? null, p_now: this.now(),
    });
    assertRpc(error);
  }

  async release(input: Parameters<WebAnswerPhaseReservationPort["release"]>[0]): Promise<void> {
    const { error } = await this.client.rpc("release_grant_web_answer_phase", {
      p_owner_id: input.state.ownerId, p_budget_id: input.state.budgetId,
      p_expected_version: input.state.version, p_phase_id: input.phaseId,
      p_next_state: input.nextState, p_now: this.now(),
    });
    assertRpc(error);
  }
}
