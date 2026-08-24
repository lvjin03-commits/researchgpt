import type { SupabaseClient } from "@supabase/supabase-js";
import { PointStatementSchema } from "../../domain/statements.ts";
import type { PointStatementRepository } from "../../ports/statement-repository.ts";

export class SupabasePointStatementRepository implements PointStatementRepository {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }
  async getStatement(input: Parameters<PointStatementRepository["getStatement"]>[0]) {
    const { data, error } = await this.client.rpc("point_statement_for_owner_v2", {
      p_owner_id: input.ownerId, p_cursor: input.cursor, p_limit: input.limit, p_kind: input.kind,
    });
    if (error) throw new Error(`point_statement_for_owner_v2 failed: ${error.message}`);
    return PointStatementSchema.parse(data);
  }
}
