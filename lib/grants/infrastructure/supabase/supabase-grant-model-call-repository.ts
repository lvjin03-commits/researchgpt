import { z } from "zod";
import { GrantModelCallAttemptSchema } from "../../model-execution/contracts.ts";
import type { GrantModelCallRepository } from "../../ports/grant-model-call-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

function assertRpc(operation: string, error: { message: string } | null) {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseGrantModelCallRepository implements GrantModelCallRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;

  constructor(client: GrantSupabaseRpcClient, ownerId: string) {
    this.client = client;
    this.ownerId = ownerId;
  }

  async start(attempt: Parameters<GrantModelCallRepository["start"]>[0]) {
    const { data, error } = await this.client.rpc("start_grant_model_call", { p_owner_id: this.ownerId, p_attempt: attempt });
    assertRpc("start_grant_model_call", error);
    return GrantModelCallAttemptSchema.parse(data);
  }

  async finish(input: Parameters<GrantModelCallRepository["finish"]>[0]) {
    const { data, error } = await this.client.rpc("finish_grant_model_call", {
      p_owner_id: this.ownerId, p_call_id: input.callId, p_expected_status: input.expectedStatus,
      p_status: input.status, p_output_hash: input.outputHash ?? null,
      p_provider_request_id: input.providerRequestId ?? null,
      p_failure_category: input.failureCategory ?? null,
      p_input_tokens: input.inputTokens, p_output_tokens: input.outputTokens,
      p_reasoning_tokens: input.reasoningTokens, p_completed_at: input.completedAt,
    });
    assertRpc("finish_grant_model_call", error);
    return GrantModelCallAttemptSchema.parse(data);
  }

  async listByTrace(documentId: string, traceId: string) {
    const { data, error } = await this.client.rpc("list_grant_model_calls_by_trace", {
      p_owner_id: this.ownerId, p_document_id: documentId, p_trace_id: traceId,
    });
    assertRpc("list_grant_model_calls_by_trace", error);
    return z.array(GrantModelCallAttemptSchema).parse(data ?? []);
  }
}
