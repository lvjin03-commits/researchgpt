-- Separate semantic input identity from generation configuration and preserve
-- one controlled capacity escalation as an independent execution attempt.

ALTER TABLE public.document_v2_model_executions
  ADD COLUMN IF NOT EXISTS content_input_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS generation_config_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1
    CHECK (attempt_number IN (1, 2)),
  ADD COLUMN IF NOT EXISTS parent_execution_key TEXT
    REFERENCES public.document_v2_model_executions(execution_key)
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS budget_escalation_count INTEGER NOT NULL DEFAULT 0
    CHECK (budget_escalation_count BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS expected_output_tokens INTEGER
    CHECK (expected_output_tokens IS NULL OR expected_output_tokens > 0),
  ADD COLUMN IF NOT EXISTS model_physical_max_output_tokens INTEGER
    CHECK (
      model_physical_max_output_tokens IS NULL
      OR model_physical_max_output_tokens > 0
    ),
  ADD COLUMN IF NOT EXISTS product_max_output_tokens INTEGER
    CHECK (product_max_output_tokens IS NULL OR product_max_output_tokens > 0),
  ADD COLUMN IF NOT EXISTS operation_hard_max_output_tokens INTEGER
    CHECK (
      operation_hard_max_output_tokens IS NULL
      OR operation_hard_max_output_tokens > 0
    ),
  ADD COLUMN IF NOT EXISTS generation_budget_policy_version TEXT,
  ADD COLUMN IF NOT EXISTS model_capability_version TEXT;

UPDATE public.document_v2_model_executions
SET
  content_input_fingerprint = COALESCE(
    content_input_fingerprint,
    input_fingerprint
  ),
  generation_config_fingerprint = COALESCE(
    generation_config_fingerprint,
    input_fingerprint
  )
WHERE
  content_input_fingerprint IS NULL
  OR generation_config_fingerprint IS NULL;

CREATE INDEX IF NOT EXISTS document_v2_model_execution_content_input_idx
  ON public.document_v2_model_executions (
    job_id,
    component_key,
    operation,
    content_input_fingerprint,
    attempt_number
  );

COMMENT ON COLUMN public.document_v2_model_executions.content_input_fingerprint IS
  'Semantic request identity; unchanged when only generation capacity changes.';
COMMENT ON COLUMN public.document_v2_model_executions.generation_config_fingerprint IS
  'Model, schema, budget policy, and effective output capacity identity.';
COMMENT ON COLUMN public.document_v2_model_executions.parent_execution_key IS
  'Previous truncated attempt when this row is the one allowed capacity escalation.';
