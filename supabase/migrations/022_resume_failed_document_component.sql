-- One-time controlled resume for the production task used to verify precise
-- component recovery after deployment.
DO $$
DECLARE
  target_id UUID := 'bc2f1644-4146-40d7-a139-171d847efb6e';
  current_job public.document_v2_jobs%ROWTYPE;
  component_index INTEGER;
  component JSONB;
  next_revision INTEGER;
  resumed_at TIMESTAMPTZ := clock_timestamp();
  next_payload JSONB;
BEGIN
  SELECT * INTO current_job
  FROM public.document_v2_jobs
  WHERE id = target_id
  FOR UPDATE;

  IF NOT FOUND OR current_job.status <> 'failed' THEN
    RETURN;
  END IF;

  SELECT ordinality::integer - 1, value
  INTO component_index, component
  FROM jsonb_array_elements(
    current_job.job_payload #> '{checkpoint,orchestration,components}'
  ) WITH ORDINALITY
  WHERE value ->> 'status' = 'failed'
  LIMIT 1;

  IF component_index IS NULL THEN
    RETURN;
  END IF;

  component := component || jsonb_build_object(
    'status', 'pending',
    'generationRevision',
      coalesce((component ->> 'generationRevision')::integer, 1) + 1,
    'attempts', 0,
    'transientFailures', 0
  );

  next_payload := jsonb_set(
    current_job.job_payload,
    ARRAY['checkpoint', 'orchestration', 'components', component_index::text],
    component,
    false
  );
  next_payload := jsonb_set(
    next_payload,
    '{checkpoint,orchestration,status}',
    '"paused"'::jsonb,
    false
  );
  next_payload := next_payload #- '{checkpoint,orchestration,failure}';
  next_revision := current_job.revision + 1;
  next_payload := (
    next_payload ||
    jsonb_build_object(
      'status', 'queued',
      'stage', 'content_generation',
      'revision', next_revision,
      'resumable', true,
      'updatedAt', to_jsonb(resumed_at)
    )
  ) - 'error' - 'finishedAt' - 'leaseOwner' - 'leaseExpiresAt';

  UPDATE public.document_v2_jobs
  SET
    status = 'queued',
    stage = 'content_generation',
    revision = next_revision,
    lease_owner = NULL,
    lease_expires_at = NULL,
    job_payload = next_payload,
    updated_at = resumed_at
  WHERE id = target_id;
END;
$$;
