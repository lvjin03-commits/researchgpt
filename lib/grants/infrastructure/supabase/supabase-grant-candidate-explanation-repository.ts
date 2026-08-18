import { z } from "zod";
import { GrantCandidateExplanationSchema } from "../../edit-session/candidate-explanation.ts";
import type { GrantCandidateExplanationRepository } from "../../ports/grant-candidate-explanation-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

const ClaimSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("acquired") }).strict(),
  z.object({ state: z.literal("in_progress") }).strict(),
  z.object({ state: z.literal("completed"), traceId: z.string().uuid(), explanation: GrantCandidateExplanationSchema }).strict(),
]);

function check(operation: string, error: { message: string } | null) {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseGrantCandidateExplanationRepository implements GrantCandidateExplanationRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;
  constructor(client: GrantSupabaseRpcClient, ownerId: string) { this.client = client; this.ownerId = ownerId; }

  async claim(input: Parameters<GrantCandidateExplanationRepository["claim"]>[0]) {
    const { data, error } = await this.client.rpc("claim_grant_candidate_explanation", { p_owner_id: this.ownerId, p_claim: input });
    check("claim_grant_candidate_explanation", error);
    return ClaimSchema.parse(data);
  }
  async complete(input: Parameters<GrantCandidateExplanationRepository["complete"]>[0]) {
    const { error } = await this.client.rpc("complete_grant_candidate_explanation", { p_owner_id: this.ownerId, p_completion: input });
    check("complete_grant_candidate_explanation", error);
  }
  async fail(input: Parameters<GrantCandidateExplanationRepository["fail"]>[0]) {
    const { error } = await this.client.rpc("fail_grant_candidate_explanation", { p_owner_id: this.ownerId, p_failure: input });
    check("fail_grant_candidate_explanation", error);
  }
}
