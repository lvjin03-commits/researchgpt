-- Restore server-side recovery for Document V2 jobs whose worker was
-- terminated before it could enqueue the next durable step.

CREATE OR REPLACE FUNCTION public.recover_expired_document_v2_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired_job RECORD;
  recovered_count INTEGER := 0;
  next_status TEXT;
  next_revision INTEGER;
  next_recovery_count INTEGER;
  recovered_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  FOR expired_job IN
    SELECT *
    FROM public.document_v2_jobs
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at < recovered_at - interval '30 seconds'
    ORDER BY lease_expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT 20
  LOOP
    next_recovery_count := expired_job.recovery_count + 1;
    next_status := CASE
      WHEN next_recovery_count >= 3 THEN 'dead_letter'
      ELSE 'queued'
    END;
    next_revision := expired_job.revision + 1;

    UPDATE public.document_v2_jobs
    SET
      status = next_status,
      revision = next_revision,
      recovery_count = next_recovery_count,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_heartbeat_at = NULL,
      job_payload = (
        expired_job.job_payload ||
        jsonb_build_object(
          'status', next_status,
          'revision', next_revision,
          'resumable', true,
          'updatedAt', to_jsonb(recovered_at),
          'checkpoint',
            coalesce(expired_job.job_payload -> 'checkpoint', '{}'::jsonb) ||
            jsonb_build_object(
              'recoveryAttempt', next_recovery_count,
              'savedAt', to_jsonb(recovered_at)
            )
        )
      ) - 'leaseOwner' - 'leaseExpiresAt',
      updated_at = recovered_at
    WHERE id = expired_job.id;

    recovered_count := recovered_count + 1;
  END LOOP;

  RETURN recovered_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_expired_document_v2_jobs()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_expired_document_v2_jobs()
  TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_pending_document_v2_outbox()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending RECORD;
  dispatched_count INTEGER := 0;
BEGIN
  PERFORM public.recover_expired_document_v2_jobs();

  FOR pending IN
    SELECT id
    FROM public.document_v2_outbox
    WHERE status = 'pending'
      AND next_attempt_at <= now()
      AND delivery_attempts < 20
    ORDER BY created_at
    LIMIT 20
  LOOP
    PERFORM public.dispatch_document_v2_outbox_event(pending.id);
    dispatched_count := dispatched_count + 1;
  END LOOP;

  UPDATE public.document_v2_outbox
  SET status = 'dead_letter'
  WHERE status = 'pending' AND delivery_attempts >= 20;

  RETURN dispatched_count;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_pending_document_v2_outbox()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_pending_document_v2_outbox()
  TO service_role;
