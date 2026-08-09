import { z } from "zod";
import { GrantFindingFeedbackSchema } from "../../feedback/contracts.ts";
import type { GrantFeedbackRepository } from "../../ports/grant-feedback-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

function throwRpcError(operation: string, error: { message: string } | null): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseGrantFeedbackRepository implements GrantFeedbackRepository {
  constructor(private readonly client: GrantSupabaseRpcClient, private readonly ownerId: string) {}

  async list(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_finding_feedback", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
    });
    throwRpcError("list_grant_finding_feedback", error);
    return z.array(GrantFindingFeedbackSchema).parse(data ?? []);
  }

  async setDisposition(input: Parameters<GrantFeedbackRepository["setDisposition"]>[0]) {
    const { data, error } = await this.client.rpc("set_grant_finding_feedback", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_finding_id: input.findingId,
      p_disposition: input.disposition,
      p_actor_id: input.actorId,
    });
    throwRpcError("set_grant_finding_feedback", error);
    return GrantFindingFeedbackSchema.parse(data);
  }
}
