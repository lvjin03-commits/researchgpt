import { z } from "zod";
import type { GrantWebGroundingRepository } from "../../ports/grant-web-grounding-repository.ts";
import { GrantWebSourceRecordSchema, GrantWebSourceUsageEventSchema } from "../../web-sources/contracts.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

const TurnSourceSchema = z.object({ source: GrantWebSourceRecordSchema, eventType: GrantWebSourceUsageEventSchema.shape.eventType }).strict();

export class SupabaseGrantWebGroundingRepository implements GrantWebGroundingRepository {
  private readonly client: GrantSupabaseRpcClient;
  private readonly ownerId: string;
  constructor(client: GrantSupabaseRpcClient, ownerId: string) { this.client = client; this.ownerId = ownerId; }
  async saveSearchResults(input: Parameters<GrantWebGroundingRepository["saveSearchResults"]>[0]) {
    const { error } = await this.client.rpc("save_grant_web_search_results", {
      p_owner_id: this.ownerId, p_document_id: input.documentId, p_search_audit_id: input.searchAuditId,
      p_sources: input.sources, p_usage_events: input.usageEvents,
    });
    if (error) throw new Error(`save_grant_web_search_results failed: ${error.message}`);
  }
  async appendUsageEvents(input: Parameters<GrantWebGroundingRepository["appendUsageEvents"]>[0]) {
    const { error } = await this.client.rpc("append_grant_web_source_usage_events", {
      p_owner_id: this.ownerId, p_document_id: input.documentId, p_usage_events: input.events,
    });
    if (error) throw new Error(`append_grant_web_source_usage_events failed: ${error.message}`);
  }
  async listTurnSources(input: Parameters<GrantWebGroundingRepository["listTurnSources"]>[0]) {
    const { data, error } = await this.client.rpc("list_grant_web_turn_sources", {
      p_owner_id: this.ownerId, p_document_id: input.documentId, p_turn_id: input.turnId,
    });
    if (error) throw new Error(`list_grant_web_turn_sources failed: ${error.message}`);
    return z.array(TurnSourceSchema).parse(data ?? []);
  }
}
