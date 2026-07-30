-- Make model response persistence and validation separate durable states.
-- This is an additive reliability migration; the existing execution key
-- remains the logical-operation idempotency boundary.

ALTER TABLE public.document_v2_model_executions
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_status_check;

ALTER TABLE public.document_v2_model_executions
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1
    CHECK (attempt > 0),
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raw_saved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_category TEXT;

ALTER TABLE public.document_v2_model_executions
  ADD CONSTRAINT document_v2_model_executions_status_check
  CHECK (
    status IN (
      'running',
      'request_started',
      'raw_saved',
      'succeeded',
      'validation_failed',
      'failed',
      'unknown_outcome'
    )
  );

CREATE INDEX IF NOT EXISTS document_v2_model_executions_recovery_idx
  ON public.document_v2_model_executions (status, lease_expires_at)
  WHERE status IN ('running', 'request_started');
