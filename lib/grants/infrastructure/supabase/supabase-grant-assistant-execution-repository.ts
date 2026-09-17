import { z } from "zod";
import { GrantAssistantExecutionSchema } from "../../assistant/execution-contracts.ts";
import type { GrantAssistantExecutionRepository } from "../../ports/grant-assistant-execution-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

function check(operation: string, error: { message: string } | null) {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

function isoTimestamp(field: string, value: unknown): string | null {
  if (value == null) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid grant assistant execution timestamp: ${field}`);
  }
  return parsed.toISOString();
}

function executionFromRpc(value: unknown) {
  const source = z.record(z.string(), z.unknown()).parse(value);
  return GrantAssistantExecutionSchema.parse({
    ...source,
    leaseExpiresAt: isoTimestamp("leaseExpiresAt", source.leaseExpiresAt),
    createdAt: isoTimestamp("createdAt", source.createdAt),
    updatedAt: isoTimestamp("updatedAt", source.updatedAt),
  });
}

const ClaimRpcSchema = z.object({ claimed: z.boolean(), execution: z.unknown() }).strict();

export class SupabaseGrantAssistantExecutionRepository implements GrantAssistantExecutionRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;

  constructor(client: GrantSupabaseRpcClient, ownerId: string) {
    this.client = client;
    this.ownerId = ownerId;
  }

  async claim(input: Parameters<GrantAssistantExecutionRepository["claim"]>[0]) {
    const { data, error } = await this.client.rpc("claim_grant_assistant_execution", {
      p_owner_id: this.ownerId, p_execution_id: input.executionId, p_document_id: input.documentId,
      p_turn_id: input.turnId, p_source_revision_id: input.sourceRevisionId, p_input_hash: input.inputHash,
      p_policy_version: input.policyVersion, p_model_id: input.modelId, p_lease_token: input.leaseToken,
      p_now: input.now, p_lease_expires_at: input.leaseExpiresAt,
    });
    check("claim_grant_assistant_execution", error);
    const result = ClaimRpcSchema.parse(data);
    return { claimed: result.claimed, execution: executionFromRpc(result.execution) };
  }

  async save(input: Parameters<GrantAssistantExecutionRepository["save"]>[0]) {
    const { data, error } = await this.client.rpc("save_grant_assistant_execution", {
      p_owner_id: this.ownerId, p_execution_id: input.executionId, p_expected_version: input.expectedVersion,
      p_lease_token: input.leaseToken, p_status: input.status, p_checkpoint: input.checkpoint,
      p_failure_reason_code: input.failureReasonCode ?? null, p_now: input.now,
      p_lease_expires_at: input.leaseExpiresAt ?? null,
    });
    check("save_grant_assistant_execution", error);
    return executionFromRpc(data);
  }
}
