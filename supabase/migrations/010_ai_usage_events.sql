-- Per-request AI usage ledger for cost monitoring and budget controls.

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  task_kind TEXT,
  project_name TEXT,
  model TEXT NOT NULL,
  model_tier TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  web_search_calls INTEGER NOT NULL DEFAULT 0 CHECK (web_search_calls >= 0),
  code_interpreter_calls INTEGER NOT NULL DEFAULT 0 CHECK (code_interpreter_calls >= 0),
  estimated_model_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_events_user_created_at_idx
  ON public.ai_usage_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_usage_events_created_at_idx
  ON public.ai_usage_events (created_at DESC);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own AI usage" ON public.ai_usage_events;
CREATE POLICY "Users select own AI usage"
  ON public.ai_usage_events
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own AI usage" ON public.ai_usage_events;
CREATE POLICY "Users insert own AI usage"
  ON public.ai_usage_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
