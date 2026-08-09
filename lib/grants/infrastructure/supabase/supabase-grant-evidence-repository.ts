import { z } from "zod";
import {
  GrantEvidenceAuthorizationSchema,
  GrantEvidenceDependencySchema,
  GrantEvidenceResourceListSchema,
  GrantEvidenceResourceSchema,
} from "../../evidence/contracts.ts";
import type { GrantEvidenceRepository } from "../../ports/grant-evidence-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

function assertRpc(operation: string, error: { message: string } | null) {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseGrantEvidenceRepository implements GrantEvidenceRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;

  constructor(client: GrantSupabaseRpcClient, ownerId: string) {
    this.client = client;
    this.ownerId = ownerId;
  }

  async createResource(resource: Parameters<GrantEvidenceRepository["createResource"]>[0]) {
    const { data, error } = await this.client.rpc("create_grant_evidence_resource", { p_owner_id: this.ownerId, p_resource: resource });
    assertRpc("create_grant_evidence_resource", error);
    return GrantEvidenceResourceSchema.parse(data);
  }

  async listResources(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_evidence_resources", { p_owner_id: this.ownerId, p_document_id: documentId });
    assertRpc("list_grant_evidence_resources", error);
    return GrantEvidenceResourceListSchema.parse(data ?? []);
  }

  async getResource(documentId: string, sourceId: string) {
    const { data, error } = await this.client.rpc("get_grant_evidence_resource", { p_owner_id: this.ownerId, p_document_id: documentId, p_source_id: sourceId });
    assertRpc("get_grant_evidence_resource", error);
    return data ? GrantEvidenceResourceSchema.parse(data) : null;
  }

  async updateAuthorization(input: Parameters<GrantEvidenceRepository["updateAuthorization"]>[0]) {
    const { data, error } = await this.client.rpc("update_grant_evidence_authorization", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_source_id: input.sourceId,
      p_expected_revision: input.expectedRevision,
      p_permissions: input.permissions,
      p_allowed_task_ids: input.allowedTaskIds ?? null,
      p_expires_at: input.expiresAt ?? null,
      p_actor_id: input.actorId,
      p_updated_at: input.updatedAt,
    });
    assertRpc("update_grant_evidence_authorization", error);
    return GrantEvidenceAuthorizationSchema.parse(data);
  }

  async revoke(input: Parameters<GrantEvidenceRepository["revoke"]>[0]) {
    const { data, error } = await this.client.rpc("revoke_grant_evidence_source", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_source_id: input.sourceId,
      p_expected_revision: input.expectedRevision,
      p_actor_id: input.actorId,
      p_revoked_at: input.revokedAt,
    });
    assertRpc("revoke_grant_evidence_source", error);
    return GrantEvidenceResourceSchema.parse(data);
  }

  async beginDeletion(input: Parameters<GrantEvidenceRepository["beginDeletion"]>[0]) {
    const { data, error } = await this.client.rpc("begin_grant_evidence_deletion", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_source_id: input.sourceId,
      p_actor_id: input.actorId,
      p_deleted_at: input.deletedAt,
    });
    assertRpc("begin_grant_evidence_deletion", error);
    return GrantEvidenceResourceSchema.parse(data);
  }

  async completeDeletion(input: Parameters<GrantEvidenceRepository["completeDeletion"]>[0]) {
    const { data, error } = await this.client.rpc("complete_grant_evidence_deletion", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_source_id: input.sourceId,
      p_actor_id: input.actorId,
      p_deleted_at: input.deletedAt,
    });
    assertRpc("complete_grant_evidence_deletion", error);
    return GrantEvidenceResourceSchema.parse(data);
  }

  async registerDependency(dependency: Parameters<GrantEvidenceRepository["registerDependency"]>[0]) {
    const { data, error } = await this.client.rpc("register_grant_evidence_dependency", { p_owner_id: this.ownerId, p_dependency: dependency });
    assertRpc("register_grant_evidence_dependency", error);
    return GrantEvidenceDependencySchema.parse(data);
  }

  async listDependencies(documentId: string, sourceId: string) {
    const { data, error } = await this.client.rpc("list_grant_evidence_dependencies", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
      p_source_id: sourceId,
    });
    assertRpc("list_grant_evidence_dependencies", error);
    return z.array(GrantEvidenceDependencySchema).parse(data ?? []);
  }
}
