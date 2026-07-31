-- Preserve provider response evidence before parsing and keep deterministic
-- parser recovery separate from provider-call idempotency. Full content is
-- encrypted by the application; this table must never receive plaintext raw
-- provider content.

ALTER TABLE public.document_v2_model_executions
  ADD COLUMN IF NOT EXISTS raw_content_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS raw_content_hash TEXT,
  ADD COLUMN IF NOT EXISTS sanitized_preview TEXT,
  ADD COLUMN IF NOT EXISTS reasoning_content_length INTEGER NOT NULL DEFAULT 0
    CHECK (reasoning_content_length >= 0),
  ADD COLUMN IF NOT EXISTS provider_response_saved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parse_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parse_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parse_status TEXT
    CHECK (parse_status IN ('succeeded', 'failed')),
  ADD COLUMN IF NOT EXISTS parse_error_message TEXT,
  ADD COLUMN IF NOT EXISTS parse_error_position INTEGER
    CHECK (parse_error_position IS NULL OR parse_error_position >= 0),
  ADD COLUMN IF NOT EXISTS candidate_count INTEGER NOT NULL DEFAULT 0
    CHECK (candidate_count >= 0),
  ADD COLUMN IF NOT EXISTS json_valid_candidate_count INTEGER NOT NULL DEFAULT 0
    CHECK (json_valid_candidate_count >= 0),
  ADD COLUMN IF NOT EXISTS schema_valid_candidate_count INTEGER NOT NULL DEFAULT 0
    CHECK (schema_valid_candidate_count >= 0),
  ADD COLUMN IF NOT EXISTS candidate_diagnostics JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS repair_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS parsed_response JSONB,
  ADD COLUMN IF NOT EXISTS parser_version TEXT,
  ADD COLUMN IF NOT EXISTS repair_pipeline_version TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT;

ALTER TABLE public.document_v2_model_executions
  DROP CONSTRAINT IF EXISTS document_v2_model_execution_candidate_counts_check;

ALTER TABLE public.document_v2_model_executions
  ADD CONSTRAINT document_v2_model_execution_candidate_counts_check
  CHECK (
    schema_valid_candidate_count <= json_valid_candidate_count
    AND json_valid_candidate_count <= candidate_count
  );

COMMENT ON COLUMN public.document_v2_model_executions.raw_content_encrypted IS
  'AES-256-GCM provider message.content evidence. Never plaintext.';
COMMENT ON COLUMN public.document_v2_model_executions.raw_response IS
  'Legacy parsed JSON response retained for compatibility.';
COMMENT ON COLUMN public.document_v2_model_executions.parsed_response IS
  'Deterministically parsed provider response after parser and schema selection.';
