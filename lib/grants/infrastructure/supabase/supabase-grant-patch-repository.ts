import { z } from "zod";
import { GrantPatchProposalSchema } from "../../patching/contracts.ts";
import type { GrantPatchRepository } from "../../ports/grant-patch-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

function throwRpcError(operation: string, error: { message: string } | null): void {
  if (error) throw new Error(`${operation} failed: ${error.message}`);
}

export class SupabaseGrantPatchRepository implements GrantPatchRepository {
  constructor(private readonly client: GrantSupabaseRpcClient, private readonly ownerId: string) {}

  async create(
    proposal: Parameters<GrantPatchRepository["create"]>[0],
    evidenceDependencies: NonNullable<Parameters<GrantPatchRepository["create"]>[1]> = [],
  ) {
    const operation = evidenceDependencies.length > 0
      ? "create_grant_evidence_backed_patch_proposal"
      : "create_grant_patch_proposal";
    const { data, error } = await this.client.rpc(operation, evidenceDependencies.length > 0 ? {
      p_owner_id: this.ownerId,
      p_proposal: proposal,
      p_dependencies: evidenceDependencies,
    } : {
      p_owner_id: this.ownerId,
      p_proposal: proposal,
    });
    throwRpcError(operation, error);
    return GrantPatchProposalSchema.parse(data);
  }

  async get(documentId: string, proposalId: string) {
    const { data, error } = await this.client.rpc("get_grant_patch_proposal", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
      p_proposal_id: proposalId,
    });
    throwRpcError("get_grant_patch_proposal", error);
    return data ? GrantPatchProposalSchema.parse(data) : null;
  }

  async list(documentId: string) {
    const { data, error } = await this.client.rpc("list_grant_patch_proposals", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
    });
    throwRpcError("list_grant_patch_proposals", error);
    return z.array(GrantPatchProposalSchema).parse(data ?? []);
  }

  async setStatus(input: Parameters<GrantPatchRepository["setStatus"]>[0]) {
    const { data, error } = await this.client.rpc("set_grant_patch_proposal_status", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_proposal_id: input.proposalId,
      p_expected_status: input.expectedStatus,
      p_status: input.status,
      p_accepted_revision_id: input.acceptedRevisionId ?? null,
      p_updated_at: input.updatedAt,
    });
    throwRpcError("set_grant_patch_proposal_status", error);
    return GrantPatchProposalSchema.parse(data);
  }
}
