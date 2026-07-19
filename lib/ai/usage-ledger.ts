import type { SupabaseClient } from "@supabase/supabase-js";
import { AIProviderError } from "@/lib/ai/errors";
import type { ChatModelTier } from "@/lib/ai/chat-models";
import type { ChatTaskKind } from "@/lib/chat/task-router";
import type { ChatStreamEvent } from "@/lib/chat/stream-protocol";

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
    usage: UsageEvent;
  },
): Promise<void> {
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
