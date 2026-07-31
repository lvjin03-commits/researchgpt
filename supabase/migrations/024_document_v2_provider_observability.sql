-- Persist safe provider response facts before parsing, and give workers one
-- transactionally fenced failure exit. No prompt or response body is exposed.

ALTER TABLE public.document_v2_model_executions
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_status_check;

ALTER TABLE public.document_v2_model_executions
  ADD COLUMN IF NOT EXISTS finish_reason TEXT,
  ADD COLUMN IF NOT EXISTS choice_count INTEGER NOT NULL DEFAULT 0
    CHECK (choice_count >= 0),
  ADD COLUMN IF NOT EXISTS content_state TEXT
    CHECK (content_state IN ('present', 'empty', 'null', 'missing')),
  ADD COLUMN IF NOT EXISTS content_length INTEGER NOT NULL DEFAULT 0
    CHECK (content_length >= 0),
  ADD COLUMN IF NOT EXISTS reasoning_content_present BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refusal_present BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tool_call_count INTEGER NOT NULL DEFAULT 0
    CHECK (tool_call_count >= 0);

ALTER TABLE public.document_v2_model_executions
  ADD CONSTRAINT document_v2_model_executions_status_check
  CHECK (
    status IN (
      'running',
      'request_started',
      'response_received',
      'raw_saved',
      'succeeded',
      'validation_failed',
      'failed',
      'unknown_outcome'
    )
  );

CREATE OR REPLACE FUNCTION public.finalize_document_v2_worker_failure(
  target_job_id UUID,
  expected_worker_id TEXT,
  failure_code TEXT,
  failure_category TEXT,
  failure_operation TEXT,
  failure_user_message TEXT,
  failure_technical_message TEXT,
  failed_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.document_v2_jobs%ROWTYPE;
  next_payload JSONB;
  next_revision INTEGER;
  next_status TEXT;
  event_status TEXT;
  event_message TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role may finalize worker failures';
  END IF;

  SELECT * INTO current_job
  FROM public.document_v2_jobs
  WHERE id = target_job_id
  FOR UPDATE;

  IF NOT FOUND
    OR current_job.status NOT IN ('running', 'cancelling')
    OR current_job.lease_owner IS DISTINCT FROM expected_worker_id
  THEN
    RETURN NULL;
  END IF;

  next_revision := current_job.revision + 1;
  IF current_job.status = 'cancelling'
    OR current_job.job_payload ? 'cancelRequestedAt'
  THEN
    next_status := 'cancelled';
    event_status := 'cancelled';
    event_message := '文档任务已取消。';
    next_payload := (
      current_job.job_payload ||
      jsonb_build_object(
        'status', next_status,
        'resumable', true,
        'revision', next_revision,
        'updatedAt', to_jsonb(failed_at),
        'finishedAt', to_jsonb(failed_at)
      )
    ) - 'leaseOwner' - 'leaseExpiresAt' - 'error';
  ELSE
    next_status := 'paused';
    event_status := 'paused';
    event_message := failure_user_message;
    next_payload := (
      current_job.job_payload ||
      jsonb_build_object(
        'status', next_status,
        'resumable', true,
        'revision', next_revision,
        'updatedAt', to_jsonb(failed_at),
        'error', jsonb_build_object(
          'code', failure_code,
          'userMessage', failure_user_message,
          'technicalMessage', left(failure_technical_message, 2000),
          'failedStage', current_job.stage
        )
      )
    ) - 'leaseOwner' - 'leaseExpiresAt' - 'finishedAt';
  END IF;

  UPDATE public.document_v2_jobs
  SET
    status = next_status,
    revision = next_revision,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_heartbeat_at = NULL,
    job_payload = next_payload,
    updated_at = failed_at
  WHERE id = target_job_id
    AND revision = current_job.revision
    AND lease_owner IS NOT DISTINCT FROM expected_worker_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM public.append_document_v2_job_event(
    current_job.id,
    current_job.owner_id,
    jsonb_build_object(
      'eventId', gen_random_uuid(),
      'jobId', current_job.id,
      'stage', current_job.stage,
      'status', event_status,
      'message', event_message,
      'category', 'recovery',
      'operation', failure_operation,
      'correlationId', current_job.id,
      'errorCode', failure_code,
      'technicalMessage', left(failure_technical_message, 2000),
      'metadata', jsonb_build_object(
        'failureCategory', failure_category,
        'workerFailureFinalized', true
      ),
      'createdAt', failed_at
    )
  );

  RETURN next_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_document_v2_worker_failure(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_document_v2_worker_failure(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;
