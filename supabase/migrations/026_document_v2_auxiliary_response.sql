-- Preserve provider-specific auxiliary response evidence without making it a
-- normal success path. Content remains encrypted and diagnostics expose facts
-- only.

ALTER TABLE public.document_v2_model_executions
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_content_state_check;

ALTER TABLE public.document_v2_model_executions
  ADD CONSTRAINT document_v2_model_executions_content_state_check
  CHECK (content_state IN ('present', 'empty', 'null', 'missing', 'whitespace'));

ALTER TABLE public.document_v2_model_executions
  ADD COLUMN IF NOT EXISTS auxiliary_content_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS auxiliary_content_hash TEXT,
  ADD COLUMN IF NOT EXISTS auxiliary_content_length INTEGER NOT NULL DEFAULT 0
    CHECK (auxiliary_content_length >= 0),
  ADD COLUMN IF NOT EXISTS auxiliary_content_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS response_source TEXT
    CHECK (response_source IN ('content', 'auxiliary_content')),
  ADD COLUMN IF NOT EXISTS recovery_mode TEXT,
  ADD COLUMN IF NOT EXISTS requested_max_tokens INTEGER
    CHECK (requested_max_tokens IS NULL OR requested_max_tokens > 0),
  ADD COLUMN IF NOT EXISTS effective_max_tokens INTEGER
    CHECK (effective_max_tokens IS NULL OR effective_max_tokens > 0),
  ADD COLUMN IF NOT EXISTS visible_output_tokens INTEGER
    CHECK (visible_output_tokens IS NULL OR visible_output_tokens >= 0);

COMMENT ON COLUMN public.document_v2_model_executions.auxiliary_content_encrypted IS
  'AES-256-GCM auxiliary provider content such as reasoning. Never plaintext.';
COMMENT ON COLUMN public.document_v2_model_executions.response_source IS
  'The normalized source selected for deterministic parsing.';
COMMENT ON COLUMN public.document_v2_model_executions.recovery_mode IS
  'Observable compatibility mode; it does not alter the business job status.';
