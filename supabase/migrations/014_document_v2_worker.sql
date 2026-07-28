-- Atomically claims one runnable document-v2 job for a trusted worker.
CREATE OR REPLACE FUNCTION public.claim_next_document_v2_job(
  target_worker_id TEXT,
  lease_expires TIMESTAMPTZ,
  lease_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.document_v2_jobs%ROWTYPE;
  next_payload JSONB;
  next_revision INTEGER;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Only the service role may claim background jobs';
  END IF;

  SELECT * INTO current_job
  FROM public.document_v2_jobs
  WHERE status = 'queued'
    AND (lease_expires_at IS NULL OR lease_expires_at <= lease_now)
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  next_revision := current_job.revision + 1;
  next_payload := current_job.job_payload || jsonb_build_object(
    'leaseOwner', target_worker_id,
    'leaseExpiresAt', to_jsonb(lease_expires),
    'updatedAt', to_jsonb(lease_now),
    'revision', next_revision
  );

  UPDATE public.document_v2_jobs SET
    lease_owner = target_worker_id,
    lease_expires_at = lease_expires,
    revision = next_revision,
    job_payload = next_payload,
    updated_at = lease_now
  WHERE id = current_job.id;

  RETURN next_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_document_v2_job(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_document_v2_job(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
