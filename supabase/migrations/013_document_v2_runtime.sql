-- Isolated document-v2 runtime persistence.
-- Prompts and generated document content are present only inside the
-- server-only checkpoint. Public APIs must remove checkpoint before response.

CREATE TABLE IF NOT EXISTS public.document_v2_jobs (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  job_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_v2_job_events (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.document_v2_jobs(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  event_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, sequence)
);

CREATE INDEX IF NOT EXISTS document_v2_jobs_owner_updated_idx
  ON public.document_v2_jobs (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS document_v2_jobs_runnable_idx
  ON public.document_v2_jobs (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS document_v2_events_job_sequence_idx
  ON public.document_v2_job_events (job_id, sequence);

ALTER TABLE public.document_v2_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_v2_job_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own document v2 jobs"
  ON public.document_v2_jobs;
CREATE POLICY "Users read own document v2 jobs"
  ON public.document_v2_jobs FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users create own document v2 jobs"
  ON public.document_v2_jobs;
CREATE POLICY "Users create own document v2 jobs"
  ON public.document_v2_jobs FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users update own document v2 jobs"
  ON public.document_v2_jobs;
CREATE POLICY "Users update own document v2 jobs"
  ON public.document_v2_jobs FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users read own document v2 events"
  ON public.document_v2_job_events;
CREATE POLICY "Users read own document v2 events"
  ON public.document_v2_job_events FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users create own document v2 events"
  ON public.document_v2_job_events;
CREATE POLICY "Users create own document v2 events"
  ON public.document_v2_job_events FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.append_document_v2_job_event(
  target_job_id UUID,
  target_owner_id UUID,
  event_without_sequence JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  next_sequence INTEGER;
  complete_event JSONB;
BEGIN
  IF auth.uid() IS DISTINCT FROM target_owner_id
    AND auth.role() <> 'service_role'
  THEN
    RAISE EXCEPTION 'Document job owner mismatch';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_job_id::text, 0));
  IF NOT EXISTS (
    SELECT 1 FROM public.document_v2_jobs
    WHERE id = target_job_id AND owner_id = target_owner_id
  ) THEN
    RAISE EXCEPTION 'Document job not found';
  END IF;
  SELECT COALESCE(MAX(sequence), 0) + 1 INTO next_sequence
  FROM public.document_v2_job_events WHERE job_id = target_job_id;
  complete_event := event_without_sequence ||
    jsonb_build_object('sequence', next_sequence);
  INSERT INTO public.document_v2_job_events (
    id, job_id, owner_id, sequence, stage, status, event_payload, created_at
  ) VALUES (
    (complete_event->>'eventId')::uuid,
    target_job_id,
    target_owner_id,
    next_sequence,
    complete_event->>'stage',
    complete_event->>'status',
    complete_event,
    (complete_event->>'createdAt')::timestamptz
  );
  RETURN complete_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_document_v2_job_lease(
  target_job_id UUID,
  target_owner_id UUID,
  target_worker_id TEXT,
  lease_expires TIMESTAMPTZ,
  lease_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  current_job public.document_v2_jobs%ROWTYPE;
  next_payload JSONB;
  next_revision INTEGER;
BEGIN
  IF auth.uid() IS DISTINCT FROM target_owner_id
    AND auth.role() <> 'service_role'
  THEN
    RAISE EXCEPTION 'Document job owner mismatch';
  END IF;
  SELECT * INTO current_job
  FROM public.document_v2_jobs
  WHERE id = target_job_id AND owner_id = target_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF current_job.lease_owner IS NOT NULL
    AND current_job.lease_expires_at > lease_now
    AND current_job.lease_owner <> target_worker_id
  THEN
    RETURN NULL;
  END IF;
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
  WHERE id = target_job_id;
  RETURN next_payload;
END;
$$;
