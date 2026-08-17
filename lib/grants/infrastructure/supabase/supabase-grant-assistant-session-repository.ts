import { z } from "zod";
import { GrantAssistantMessageSchema, GrantAssistantSessionSchema } from "../../assistant/session-contracts.ts";
import type { GrantAssistantSessionRepository } from "../../ports/grant-assistant-session-repository.ts";
import type { GrantSupabaseRpcClient } from "./supabase-grant-revision-repository.ts";

function check(operation: string, error: { message: string } | null) { if (error) throw new Error(`${operation} failed: ${error.message}`); }

export class SupabaseGrantAssistantSessionRepository implements GrantAssistantSessionRepository {
  constructor(private readonly client: GrantSupabaseRpcClient, private readonly ownerId: string) {}
  async ensureSession(input: Parameters<GrantAssistantSessionRepository["ensureSession"]>[0]) {
    const { data, error } = await this.client.rpc("ensure_grant_assistant_session", { p_owner_id: this.ownerId, p_document_id: input.documentId, p_session_id: input.sessionId, p_now: input.now });
    check("ensure_grant_assistant_session", error); return GrantAssistantSessionSchema.parse(data);
  }
  async getCurrentSession(documentId: string) {
    const { data, error } = await this.client.rpc("get_current_grant_assistant_session", { p_owner_id: this.ownerId, p_document_id: documentId });
    check("get_current_grant_assistant_session", error); return data ? GrantAssistantSessionSchema.parse(data) : null;
  }
  async listMessages(sessionId: string) {
    const { data, error } = await this.client.rpc("list_grant_assistant_messages", { p_owner_id: this.ownerId, p_session_id: sessionId });
    check("list_grant_assistant_messages", error); return z.array(GrantAssistantMessageSchema).parse(data ?? []);
  }
  async appendTurn(input: Parameters<GrantAssistantSessionRepository["appendTurn"]>[0]) {
    const { error } = await this.client.rpc("append_grant_assistant_turn", { p_owner_id: this.ownerId, p_session_id: input.sessionId, p_user_message: input.userMessage, p_assistant_message: input.assistantMessage, p_last_active_at: input.lastActiveAt });
    check("append_grant_assistant_turn", error);
  }
  async linkEditSession(input: Parameters<GrantAssistantSessionRepository["linkEditSession"]>[0]) {
    const { error } = await this.client.rpc("link_grant_assistant_edit_session", { p_owner_id: this.ownerId, p_assistant_session_id: input.assistantSessionId, p_edit_session_id: input.editSessionId, p_linked_at: input.linkedAt });
    check("link_grant_assistant_edit_session", error);
  }
}
