import { GrantDocumentMemorySnapshotSchema } from "../../assistant/document-memory-contracts.ts";
import type { GrantDocumentMemoryRepository } from "../../ports/grant-document-memory-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

function throwRpcError(operation: string, error: { message: string } | null) {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseGrantDocumentMemoryRepository implements GrantDocumentMemoryRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;

  constructor(client: GrantSupabaseRpcClient, ownerId: string) {
    this.client = client;
    this.ownerId = ownerId;
  }

  async findReusable(input: Parameters<GrantDocumentMemoryRepository["findReusable"]>[0]) {
    const { data, error } = await this.client.rpc("find_reusable_grant_document_memory", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_source_revision_id: input.sourceRevisionId,
      p_context_hash: input.contextHash,
      p_policy_version: input.policyVersion,
    });
    throwRpcError("find_reusable_grant_document_memory", error);
    return data ? GrantDocumentMemorySnapshotSchema.parse(data) : null;
  }

  async save(snapshot: Parameters<GrantDocumentMemoryRepository["save"]>[0]) {
    const parsed = GrantDocumentMemorySnapshotSchema.parse(snapshot);
    const { data, error } = await this.client.rpc("save_grant_document_memory", {
      p_owner_id: this.ownerId,
      p_snapshot: parsed,
    });
    throwRpcError("save_grant_document_memory", error);
    return GrantDocumentMemorySnapshotSchema.parse(data);
  }
}
