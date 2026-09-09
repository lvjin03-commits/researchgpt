import type { GrantWebSearchEgressAuditRepository } from "../../ports/grant-web-search-egress-audit-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

export class SupabaseGrantWebSearchEgressAuditRepository implements GrantWebSearchEgressAuditRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;
  constructor(client: GrantSupabaseRpcClient, ownerId: string) { this.client = client; this.ownerId = ownerId; }
  async append(event: Parameters<GrantWebSearchEgressAuditRepository["append"]>[0]) {
    const { error } = await this.client.rpc("append_grant_web_search_egress_audit", { p_owner_id: this.ownerId, p_event: event });
    if (error) throw new Error(`append_grant_web_search_egress_audit failed: ${error.message}`);
  }
}
