import { GrantFigureModelAuthorizationSchema } from "../../domain/figure-assets.ts";
import type { GrantFigureAuthorizationRepository } from "../../ports/grant-figure-authorization-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

export class SupabaseGrantFigureAuthorizationRepository implements GrantFigureAuthorizationRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;

  constructor(
    client: GrantSupabaseRpcClient,
    ownerId: string,
  ) {
    this.client = client;
    this.ownerId = ownerId;
  }

  async getCurrent(documentId: string) {
    const { data, error } = await this.client.rpc("get_grant_figure_model_authorization", {
      p_owner_id: this.ownerId,
      p_document_id: documentId,
    });
    if (error) throw new Error(`get_grant_figure_model_authorization failed: ${error.message}`);
    return data ? GrantFigureModelAuthorizationSchema.parse(data) : null;
  }

  async save(input: Parameters<GrantFigureAuthorizationRepository["save"]>[0]) {
    const { data, error } = await this.client.rpc("save_grant_figure_model_authorization", {
      p_owner_id: this.ownerId,
      p_document_id: input.documentId,
      p_expected_authorization_revision: input.expectedAuthorizationRevision,
      p_authorization: input.authorization,
    });
    if (error) throw new Error(`save_grant_figure_model_authorization failed: ${error.message}`);
    return GrantFigureModelAuthorizationSchema.parse(data);
  }
}
