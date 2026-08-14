import { z } from "zod";
import { GrantAiEditCandidateSchema, GrantAiEditSessionSchema, GrantAiEditTurnSchema } from "../../edit-session/contracts.ts";
import type { GrantAiEditSessionRepository } from "../../ports/grant-ai-edit-session-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

function assertRpc(operation: string, error: { message: string } | null) {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseGrantAiEditSessionRepository implements GrantAiEditSessionRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;
  constructor(client: GrantSupabaseRpcClient, ownerId: string) { this.client = client; this.ownerId = ownerId; }
  async createSession(session: Parameters<GrantAiEditSessionRepository["createSession"]>[0]) {
    const { error } = await this.client.rpc("create_grant_ai_edit_session", { p_owner_id: this.ownerId, p_session: session }); assertRpc("create_grant_ai_edit_session", error);
  }
  async getSession(sessionId: string) {
    const { data, error } = await this.client.rpc("get_grant_ai_edit_session", { p_owner_id: this.ownerId, p_session_id: sessionId }); assertRpc("get_grant_ai_edit_session", error); return data ? GrantAiEditSessionSchema.parse(data) : null;
  }
  async createTurn(turn: Parameters<GrantAiEditSessionRepository["createTurn"]>[0]) {
    const { error } = await this.client.rpc("create_grant_ai_edit_turn", { p_owner_id: this.ownerId, p_turn: turn }); assertRpc("create_grant_ai_edit_turn", error);
  }
  async completeTurnWithCandidate(input: Parameters<GrantAiEditSessionRepository["completeTurnWithCandidate"]>[0]) {
    const { error } = await this.client.rpc("complete_grant_ai_edit_turn", { p_owner_id: this.ownerId, p_turn_id: input.turnId, p_completed_at: input.completedAt, p_candidate: input.candidate }); assertRpc("complete_grant_ai_edit_turn", error);
  }
  async failTurn(input: Parameters<GrantAiEditSessionRepository["failTurn"]>[0]) {
    const { error } = await this.client.rpc("fail_grant_ai_edit_turn", { p_owner_id: this.ownerId, p_turn_id: input.turnId, p_completed_at: input.completedAt, p_failure_category: input.failureCategory }); assertRpc("fail_grant_ai_edit_turn", error);
  }
  private async updateSession(sessionId: string, patch: Record<string, unknown>, lastActiveAt: string) {
    const { error } = await this.client.rpc("update_grant_ai_edit_session_state", { p_owner_id: this.ownerId, p_session_id: sessionId, p_patch: patch, p_updated_at: lastActiveAt }); assertRpc("update_grant_ai_edit_session_state", error);
  }
  markSessionStale(sessionId: string, lastActiveAt: string) { return this.updateSession(sessionId, { status: "stale" }, lastActiveAt); }
  async markCandidateNeedsRepair(candidateId: string) {
    const { error } = await this.client.rpc("mark_grant_ai_edit_candidate_needs_repair", { p_owner_id: this.ownerId, p_candidate_id: candidateId }); assertRpc("mark_grant_ai_edit_candidate_needs_repair", error);
  }
  markSessionApplied(input: Parameters<GrantAiEditSessionRepository["markSessionApplied"]>[0]) {
    return this.updateSession(input.sessionId, { status: "applied", appliedCandidateId: input.candidateId, appliedProposalId: input.proposalId, appliedRevisionId: input.revisionId }, input.lastActiveAt);
  }
  async listTurns(sessionId: string) {
    const { data, error } = await this.client.rpc("list_grant_ai_edit_turns", { p_owner_id: this.ownerId, p_session_id: sessionId }); assertRpc("list_grant_ai_edit_turns", error); return z.array(GrantAiEditTurnSchema).parse(data ?? []);
  }
  async listCandidates(sessionId: string) {
    const { data, error } = await this.client.rpc("list_grant_ai_edit_candidates", { p_owner_id: this.ownerId, p_session_id: sessionId }); assertRpc("list_grant_ai_edit_candidates", error); return z.array(GrantAiEditCandidateSchema).parse(data ?? []);
  }
}
