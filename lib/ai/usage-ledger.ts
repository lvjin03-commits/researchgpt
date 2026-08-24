import type { SupabaseClient } from "@supabase/supabase-js";
import { AIProviderError } from "@/lib/ai/errors";
import type { ChatModelTier } from "@/lib/ai/chat-models";
import type { ChatTaskKind } from "@/lib/chat/task-router";
import type { ChatStreamEvent } from "@/lib/chat/stream-protocol";
import { randomUUID } from "node:crypto";
import { operationForChatTaskKind } from "@/lib/ai/operation-registry";
import { tokenUsage, type AiUsageEnvelope } from "@/lib/ai/billable-usage";
import { AiUsageIntegration, resolveAiBillingIntegrationMode } from "@/lib/billing/application/ai-usage-integration";
import { SupabaseAiUsageEventSink } from "@/lib/billing/infrastructure/supabase/supabase-ai-usage-event-sink";

type UsageEvent = Extract<ChatStreamEvent, { type: "usage" }>;

function dailyBudgetUsd(): number | null {
  const raw = process.env.AI_DAILY_USER_BUDGET_USD?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function assertDailyAiBudgetAvailable(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const budget = dailyBudgetUsd();
  if (!budget) return;

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data, error } = await supabase
    .from("ai_usage_events")
    .select("estimated_model_cost_usd")
    .eq("user_id", userId)
    .gte("created_at", start.toISOString());

  if (error) {
    console.warn("[ai-usage] Daily budget lookup unavailable:", error.message);
    return;
  }

  const spent = (data ?? []).reduce(
    (sum, row) => sum + Number(row.estimated_model_cost_usd ?? 0),
    0,
  );
  if (spent >= budget) {
    throw new AIProviderError(
      `Daily AI budget reached ($${spent.toFixed(2)} / $${budget.toFixed(2)}).`,
      { statusCode: 429, provider: "openai" },
    );
  }
}

export async function recordAiUsage(
  supabase: SupabaseClient,
  params: {
    userId: string;
    feature: string;
    taskKind: ChatTaskKind;
    projectName: string;
    modelTier: ChatModelTier;
    provider: string;
    billingOperationId: string;
    usage: UsageEvent;
  },
): Promise<void> {
  const mode = resolveAiBillingIntegrationMode();
  if (mode === "meter_only") {
    const envelope: AiUsageEnvelope = {
      usageEventId: randomUUID(),
      billingOperationId: params.billingOperationId,
      operation: operationForChatTaskKind(params.taskKind),
      provider: params.provider,
      modelId: params.usage.model,
      attemptNumber: 1,
      cacheHit: false,
      usage: [
        tokenUsage(params.usage),
        ...(params.usage.webSearchCalls > 0
          ? [{ kind: "tool_call" as const, tool: "web_search", count: params.usage.webSearchCalls }]
          : []),
        ...(params.usage.codeInterpreterCalls > 0
          ? [{ kind: "tool_call" as const, tool: "code_interpreter", count: params.usage.codeInterpreterCalls }]
          : []),
      ],
      occurredAt: new Date().toISOString(),
    };
    await new AiUsageIntegration(
      new SupabaseAiUsageEventSink(supabase, {
        feature: params.feature,
        taskKind: params.taskKind,
        projectName: params.projectName,
        modelTier: params.modelTier,
      }),
      mode,
    ).record(params.userId, envelope);
    return;
  }
  const { error } = await supabase.from("ai_usage_events").insert({
    user_id: params.userId,
    feature: params.feature,
    task_kind: params.taskKind,
    project_name: params.projectName || null,
    model: params.usage.model,
    model_tier: params.modelTier,
    input_tokens: params.usage.inputTokens,
    cached_input_tokens: params.usage.cachedInputTokens,
    output_tokens: params.usage.outputTokens,
    reasoning_tokens: params.usage.reasoningTokens,
    web_search_calls: params.usage.webSearchCalls,
    code_interpreter_calls: params.usage.codeInterpreterCalls,
    estimated_model_cost_usd: params.usage.estimatedCostUsd,
  });

  if (error) {
    console.warn("[ai-usage] Usage event was not persisted:", error.message);
  }
}
