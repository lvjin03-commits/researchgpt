-- Add billing-grade factual identity to the existing monitoring event stream.
-- This migration does not calculate prices or mutate point balances.

ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS operation TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS billing_operation_id UUID,
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER,
  ADD COLUMN IF NOT EXISTS cache_hit BOOLEAN,
  ADD COLUMN IF NOT EXISTS standardized_usage JSONB;

ALTER TABLE public.ai_usage_events
  DROP CONSTRAINT IF EXISTS ai_usage_events_attempt_number_check;
ALTER TABLE public.ai_usage_events
  ADD CONSTRAINT ai_usage_events_attempt_number_check
  CHECK (attempt_number IS NULL OR attempt_number > 0);

CREATE INDEX IF NOT EXISTS ai_usage_events_billing_operation_idx
  ON public.ai_usage_events (user_id, billing_operation_id, created_at DESC)
  WHERE billing_operation_id IS NOT NULL;

COMMENT ON COLUMN public.ai_usage_events.standardized_usage IS
  'Factual provider/tool usage only. Pricing and balance mutation are forbidden here.';
