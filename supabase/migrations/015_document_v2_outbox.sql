CREATE TABLE IF NOT EXISTS public.document_v2_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.document_v2_jobs(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('job_created', 'continue_job', 'resume_job')),
  deduplication_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'dead_letter')),
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.document_v2_jobs
  ADD COLUMN IF NOT EXISTS recovery_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS document_v2_outbox_pending_idx
  ON public.document_v2_outbox (status, next_attempt_at, created_at);

ALTER TABLE public.document_v2_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_v2_outbox FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_document_v2_job_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transition_type TEXT;
BEGIN
  IF NEW.status <> 'queued' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    transition_type := 'job_created';
  ELSIF OLD.status IS DISTINCT FROM 'queued' OR OLD.revision IS DISTINCT FROM NEW.revision THEN
    transition_type := 'continue_job';
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO public.document_v2_outbox (
    job_id, owner_id, event_type, deduplication_key
  ) VALUES (
    NEW.id,
    NEW.owner_id,
    transition_type,
    NEW.id::text || ':' || transition_type || ':' || NEW.revision::text
  ) ON CONFLICT (deduplication_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_v2_job_outbox_trigger
  ON public.document_v2_jobs;
CREATE TRIGGER document_v2_job_outbox_trigger
AFTER INSERT OR UPDATE OF status, revision
ON public.document_v2_jobs
FOR EACH ROW EXECUTE FUNCTION public.enqueue_document_v2_job_transition();

CREATE OR REPLACE FUNCTION public.claim_next_document_v2_dispatch(
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
  UPDATE public.document_v2_jobs
  SET
    status = CASE WHEN recovery_count >= 3 THEN 'dead_letter' ELSE 'queued' END,
    stage = stage,
    recovery_count = recovery_count + 1,
    revision = revision + 1,
    lease_owner = NULL,
    lease_expires_at = NULL,
    job_payload = (
      job_payload || jsonb_build_object(
        'status', CASE WHEN recovery_count >= 3 THEN 'dead_letter' ELSE 'queued' END,
        'updatedAt', to_jsonb(lease_now),
        'revision', revision + 1
      )
    ) - 'leaseOwner' - 'leaseExpiresAt',
    updated_at = lease_now
  WHERE status = 'running'
    AND lease_expires_at IS NOT NULL
    AND lease_expires_at <= lease_now;

  SELECT * INTO dispatch
  FROM public.document_v2_outbox
  WHERE status = 'pending' AND next_attempt_at <= lease_now
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO current_job
  FROM public.document_v2_jobs
  WHERE id = dispatch.job_id
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
  WHERE id = current_job.id;
  UPDATE public.document_v2_outbox SET
    status = 'delivered',
    delivered_at = lease_now,
    delivery_attempts = delivery_attempts + 1
  WHERE id = dispatch.id;
  RETURN next_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_document_v2_dispatch(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_document_v2_dispatch(
  TEXT, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
