import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiUsageEnvelope } from "../../../ai/billable-usage.ts";
import type { AiUsageEventSink } from "../../application/ai-usage-integration.ts";

export class SupabaseAiUsageEventSink implements AiUsageEventSink {
  private readonly client: SupabaseClient;
  private readonly projection: Readonly<{
    feature: string;
    taskKind?: string;
    projectName?: string;
    modelTier?: string;
  }>;

  constructor(
    client: SupabaseClient,
    projection: Readonly<{
      feature: string;
      taskKind?: string;
      projectName?: string;
      modelTier?: string;
    }> = { feature: "site_ai" },
  ) {
    this.client = client;
    this.projection = projection;
  }

  async append(ownerId: string, envelope: AiUsageEnvelope): Promise<void> {
    const token = envelope.usage.find((usage) => usage.kind === "tokens");
    const toolCalls = envelope.usage.filter((usage) => usage.kind === "tool_call");
    const { error } = await this.client.from("ai_usage_events").upsert({
      id: envelope.usageEventId,
      user_id: ownerId,
      feature: this.projection.feature,
      task_kind: this.projection.taskKind ?? null,
      project_name: this.projection.projectName || null,
      model: envelope.modelId,
      model_tier: this.projection.modelTier ?? null,
      operation: envelope.operation,
      provider: envelope.provider,
      billing_operation_id: envelope.billingOperationId,
      attempt_number: envelope.attemptNumber,
      cache_hit: envelope.cacheHit,
      standardized_usage: envelope.usage,
      input_tokens: token?.kind === "tokens" ? token.inputTokens : 0,
      cached_input_tokens: token?.kind === "tokens" ? token.cachedInputTokens : 0,
      output_tokens: token?.kind === "tokens" ? token.outputTokens : 0,
      reasoning_tokens: token?.kind === "tokens" ? token.reasoningTokens : 0,
      web_search_calls: toolCalls
        .filter((usage) => usage.tool === "web_search")
        .reduce((sum, usage) => sum + usage.count, 0),
      code_interpreter_calls: toolCalls
        .filter((usage) => usage.tool === "code_interpreter")
        .reduce((sum, usage) => sum + usage.count, 0),
      created_at: envelope.occurredAt,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
}
