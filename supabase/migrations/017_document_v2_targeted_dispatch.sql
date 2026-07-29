CREATE OR REPLACE FUNCTION public.claim_document_v2_dispatch(
  target_job_id UUID,
  target_worker_id TEXT,
  lease_expires TIMESTAMPTZ,
  lease_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dispatch public.document_v2_outbox%ROWTYPE;
  current_job public.document_v2_jobs%ROWTYPE;
  next_payload JSONB;
  next_revision INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role may claim background jobs';
  END IF;

  SELECT * INTO dispatch
  FROM public.document_v2_outbox
  WHERE job_id = target_job_id
    AND status = 'pending'
    AND next_attempt_at <= lease_now
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO current_job
  FROM public.document_v2_jobs
  WHERE id = target_job_id
  FOR UPDATE;
  IF NOT FOUND OR current_job.status <> 'queued' THEN
    UPDATE public.document_v2_outbox
    SET status = 'delivered', delivered_at = lease_now
    WHERE id = dispatch.id;
    RETURN NULL;
  END IF;

  next_revision := current_job.revision + 1;
  next_payload := current_job.job_payload || jsonb_build_object(
    'status', 'running',
    'leaseOwner', target_worker_id,
    'leaseExpiresAt', to_jsonb(lease_expires),
    'updatedAt', to_jsonb(lease_now),
    'revision', next_revision
  );
  UPDATE public.document_v2_jobs SET
    status = 'running',
    lease_owner = target_worker_id,
    lease_expires_at = lease_expires,
    revision = next_revision,
    job_payload = next_payload,
    updated_at = lease_now
  WHERE id = target_job_id;
  UPDATE public.document_v2_outbox SET
    status = 'delivered',
    delivered_at = lease_now,
    delivery_attempts = delivery_attempts + 1
  WHERE id = dispatch.id;
  RETURN next_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_document_v2_dispatch(
  UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_document_v2_dispatch(
  UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
