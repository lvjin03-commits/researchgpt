import type { SupabaseClient } from "@supabase/supabase-js";
import { ResumeIntentSchema, type ResumeIntent } from "../../domain/resume-intents.ts";
import type { ResumeIntentRepository } from "../../ports/resume-intent-repository.ts";

function parseIntent(value: unknown): ResumeIntent {
  return ResumeIntentSchema.parse(value);
}

export class SupabaseResumeIntentRepository implements ResumeIntentRepository {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }

  async create(input: Parameters<ResumeIntentRepository["create"]>[0]) {
    const { data, error } = await this.client.rpc("create_resume_intent", { p_intent: input });
    if (error) throw new Error(`create_resume_intent failed: ${error.message}`);
    return parseIntent(data);
  }

  async get(input: Parameters<ResumeIntentRepository["get"]>[0]) {
    const { data, error } = await this.client.rpc("resume_intent_for_owner", {
      p_resume_intent_id: input.resumeIntentId,
      p_owner_id: input.ownerId,
    });
    if (error) throw new Error(`resume_intent_for_owner failed: ${error.message}`);
    return data ? parseIntent(data) : null;
  }

  async transition(input: Parameters<ResumeIntentRepository["transition"]>[0]) {
    const { data, error } = await this.client.rpc("transition_resume_intent", {
      p_resume_intent_id: input.resumeIntentId,
      p_owner_id: input.ownerId,
      p_from_statuses: input.from,
      p_to_status: input.to,
      p_now: input.now,
    });
    if (error) throw new Error(`transition_resume_intent failed: ${error.message}`);
    return parseIntent(data);
  }
}
