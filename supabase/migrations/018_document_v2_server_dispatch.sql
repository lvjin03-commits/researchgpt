CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.document_v2_runtime_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.document_v2_runtime_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_v2_runtime_settings FROM PUBLIC, anon, authenticated;

INSERT INTO public.document_v2_runtime_settings (setting_key, setting_value)
VALUES (
  'worker_url',
  'https://researchgpt-ivory.vercel.app/api/internal/document-v2-worker'
)
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value, updated_at = now();

CREATE OR REPLACE FUNCTION public.dispatch_document_v2_outbox_event(
  target_outbox_id UUID
) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  worker_url TEXT;
  target_job_id UUID;
  dispatch_token TEXT;
  request_id BIGINT;
BEGIN
  SELECT setting_value INTO worker_url
  FROM public.document_v2_runtime_settings
  WHERE setting_key = 'worker_url';

  SELECT
    outbox.job_id,
    job.job_payload #>> '{checkpoint,dispatchToken}'
  INTO target_job_id, dispatch_token
  FROM public.document_v2_outbox AS outbox
  JOIN public.document_v2_jobs AS job ON job.id = outbox.job_id
  WHERE outbox.id = target_outbox_id
    AND outbox.status = 'pending';

  IF worker_url IS NULL OR target_job_id IS NULL OR dispatch_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := worker_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'cause', 'outbox',
      'jobId', target_job_id,
      'dispatchToken', dispatch_token
    ),
    timeout_milliseconds := 5000
  ) INTO request_id;

  UPDATE public.document_v2_outbox
  SET
    delivery_attempts = delivery_attempts + 1,
    next_attempt_at = now() + interval '1 minute'
  WHERE id = target_outbox_id AND status = 'pending';

  RETURN request_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'document-v2 outbox dispatch failed for %: %',
    target_outbox_id, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_document_v2_outbox_event(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_document_v2_outbox_event(UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_new_document_v2_outbox_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.dispatch_document_v2_outbox_event(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_v2_outbox_dispatch_trigger
  ON public.document_v2_outbox;
CREATE TRIGGER document_v2_outbox_dispatch_trigger
AFTER INSERT ON public.document_v2_outbox
FOR EACH ROW EXECUTE FUNCTION public.dispatch_new_document_v2_outbox_event();

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

DO $$
DECLARE
  existing_job_id BIGINT;
BEGIN
  SELECT jobid INTO existing_job_id
  FROM cron.job
  WHERE jobname = 'document-v2-outbox-dispatch';
  IF existing_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job_id);
  END IF;
  PERFORM cron.schedule(
    'document-v2-outbox-dispatch',
    '* * * * *',
    'SELECT public.dispatch_pending_document_v2_outbox();'
  );
END;
$$;

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
    delivered_at = lease_now
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
