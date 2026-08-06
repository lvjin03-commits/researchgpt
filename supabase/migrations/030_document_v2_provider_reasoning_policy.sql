-- Keep provider-neutral effort separate from provider-specific reasoning mode.
-- This migration is additive and preserves all historical execution records.

ALTER TABLE public.document_v2_model_executions
  ADD COLUMN IF NOT EXISTS provider_reasoning_mode TEXT,
  ADD COLUMN IF NOT EXISTS provider_reasoning_policy JSONB,
  ADD COLUMN IF NOT EXISTS provider_reasoning_policy_version TEXT;

ALTER TABLE public.document_v2_model_executions
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_effective_reasoning_effort_check,
  ADD CONSTRAINT document_v2_model_executions_effective_reasoning_effort_check
    CHECK (
      effective_reasoning_effort IS NULL OR
      effective_reasoning_effort IN ('none', 'low', 'medium', 'high', 'max')
    ),
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_provider_reasoning_mode_check,
  ADD CONSTRAINT document_v2_model_executions_provider_reasoning_mode_check
    CHECK (
      provider_reasoning_mode IS NULL OR
      provider_reasoning_mode IN ('disabled', 'enabled', 'effort')
    ),
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_provider_reasoning_policy_check,
  ADD CONSTRAINT document_v2_model_executions_provider_reasoning_policy_check
    CHECK (
      provider_reasoning_policy IS NULL OR
      jsonb_typeof(provider_reasoning_policy) = 'object'
    );

COMMENT ON COLUMN public.document_v2_model_executions.effective_reasoning_effort IS
  'Provider-neutral effective effort: none, low, medium, high, or max.';
COMMENT ON COLUMN public.document_v2_model_executions.provider_reasoning_mode IS
  'Provider request mode, kept separate from reasoning effort.';
COMMENT ON COLUMN public.document_v2_model_executions.provider_reasoning_policy IS
  'Validated provider-specific reasoning request policy; contains configuration only.';
COMMENT ON COLUMN public.document_v2_model_executions.provider_reasoning_policy_version IS
  'Version of the provider-specific reasoning policy projection.';
