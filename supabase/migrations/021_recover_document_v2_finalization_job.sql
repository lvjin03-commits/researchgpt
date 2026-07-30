-- One-time controlled recovery for the production task that reached a durable
-- rendered artifact before the reliable finalization release was deployed.
DO $$
DECLARE
  target_id UUID := 'e31ce3bf-f392-4b96-99d3-771ad8edf7fb';
  current_job public.document_v2_jobs%ROWTYPE;
  recovered_at TIMESTAMPTZ := clock_timestamp();
  next_revision INTEGER;
BEGIN
  SELECT * INTO current_job
  FROM public.document_v2_jobs
  WHERE id = target_id
  FOR UPDATE;

  IF NOT FOUND OR current_job.status = 'completed' THEN
    RETURN;
  END IF;

  IF current_job.job_payload #>> '{checkpoint,renderedArtifactId}' IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      coalesce(
        current_job.job_payload #> '{checkpoint,orchestration,components}',
        '[]'::jsonb
      )
    ) AS component
    WHERE component ->> 'status' <> 'approved'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      coalesce(
        current_job.job_payload #> '{checkpoint,orchestration,figures}',
        '[]'::jsonb
      )
    ) AS figure
    WHERE figure ->> 'status' <> 'approved'
  ) THEN
    RETURN;
  END IF;

  next_revision := current_job.revision + 1;
  UPDATE public.document_v2_jobs
  SET
    status = 'queued',
    stage = 'quality_check',
    revision = next_revision,
    recovery_count = 0,
    lease_owner = NULL,
    lease_expires_at = NULL,
    last_heartbeat_at = NULL,
    job_payload = (
      current_job.job_payload ||
      jsonb_build_object(
        'status', 'queued',
        'stage', 'quality_check',
        'progress', 95,
        'revision', next_revision,
        'resumable', true,
        'updatedAt', to_jsonb(recovered_at),
        'checkpoint',
          (current_job.job_payload -> 'checkpoint') ||
          jsonb_build_object(
            'recoveryAttempt', 0,
            'savedAt', to_jsonb(recovered_at)
          )
      )
    ) - 'leaseOwner' - 'leaseExpiresAt' - 'error' - 'finishedAt',
    updated_at = recovered_at
  WHERE id = target_id;
END;
$$;
