-- Freeze and observe reasoning configuration independently from output capacity.
-- This migration is additive; applying it requires explicit production authorization.

ALTER TABLE public.document_v2_model_executions
  ADD COLUMN IF NOT EXISTS requested_reasoning_effort TEXT,
  ADD COLUMN IF NOT EXISTS effective_reasoning_effort TEXT,
  ADD COLUMN IF NOT EXISTS reasoning_tokens_observed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS calculated_cost_usd NUMERIC(14, 8),
  ADD COLUMN IF NOT EXISTS pricing_version TEXT,
  ADD COLUMN IF NOT EXISTS cost_status TEXT;

ALTER TABLE public.document_v2_model_executions
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_reasoning_effort_check,
  ADD CONSTRAINT document_v2_model_executions_reasoning_effort_check
    CHECK (
      requested_reasoning_effort IS NULL OR
      requested_reasoning_effort IN ('none', 'low', 'medium')
    ),
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_effective_reasoning_effort_check,
  ADD CONSTRAINT document_v2_model_executions_effective_reasoning_effort_check
    CHECK (
      effective_reasoning_effort IS NULL OR
      effective_reasoning_effort IN ('none', 'low', 'medium')
    ),
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_cost_status_check,
  ADD CONSTRAINT document_v2_model_executions_cost_status_check
    CHECK (cost_status IS NULL OR cost_status IN ('calculated', 'unpriced'));

COMMENT ON COLUMN public.document_v2_model_executions.effective_reasoning_effort IS
  'Frozen operation-level reasoning effort included in the generation fingerprint.';
COMMENT ON COLUMN public.document_v2_model_executions.calculated_cost_usd IS
  'Cost calculated as soon as provider usage is durable, including failed attempts.';
