CREATE OR REPLACE FUNCTION public.document_v2_runtime_health(
  checked_at TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending_outbox_count INTEGER;
  overdue_outbox_count INTEGER;
  queued_job_count INTEGER;
  overdue_queued_job_count INTEGER;
  expired_running_job_count INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role may inspect the document runtime';
  END IF;

  SELECT count(*)::INTEGER INTO pending_outbox_count
  FROM public.document_v2_outbox
  WHERE status = 'pending';

  SELECT count(*)::INTEGER INTO overdue_outbox_count
  FROM public.document_v2_outbox
  WHERE status = 'pending'
    AND next_attempt_at <= checked_at - interval '2 minutes';

  SELECT count(*)::INTEGER INTO queued_job_count
  FROM public.document_v2_jobs
  WHERE status = 'queued';

  SELECT count(*)::INTEGER INTO overdue_queued_job_count
  FROM public.document_v2_jobs
  WHERE status = 'queued'
    AND updated_at <= checked_at - interval '2 minutes';

  SELECT count(*)::INTEGER INTO expired_running_job_count
  FROM public.document_v2_jobs
  WHERE status = 'running'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at <= checked_at;

  RETURN jsonb_build_object(
    'checkedAt', checked_at,
    'pendingOutbox', pending_outbox_count,
    'overdueOutbox', overdue_outbox_count,
    'queuedJobs', queued_job_count,
    'overdueQueuedJobs', overdue_queued_job_count,
    'expiredRunningJobs', expired_running_job_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.document_v2_runtime_health(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.document_v2_runtime_health(TIMESTAMPTZ)
  TO service_role;
