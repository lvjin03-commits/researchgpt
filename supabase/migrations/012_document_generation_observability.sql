-- Durable document-generation traces. Content and prompts are intentionally not stored.

CREATE TABLE IF NOT EXISTS public.document_generation_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_version TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  request_chars INTEGER NOT NULL DEFAULT 0 CHECK (request_chars >= 0),
  requested_formats TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'running', 'succeeded', 'failed', 'cancelled')),
  current_stage TEXT,
  route_decision JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id TEXT,
  template_version TEXT,
  artifact_ids UUID[] NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_generation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.document_generation_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  component_id TEXT,
  attempt INTEGER CHECK (attempt IS NULL OR attempt > 0),
  status TEXT NOT NULL
    CHECK (status IN ('started', 'succeeded', 'failed', 'retrying', 'info')),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_generation_jobs_user_started_idx
  ON public.document_generation_jobs (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS document_generation_jobs_status_idx
  ON public.document_generation_jobs (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS document_generation_events_job_created_idx
  ON public.document_generation_events (job_id, created_at);

ALTER TABLE public.document_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_generation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own document jobs" ON public.document_generation_jobs;
CREATE POLICY "Users select own document jobs"
  ON public.document_generation_jobs
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own document jobs" ON public.document_generation_jobs;
CREATE POLICY "Users insert own document jobs"
  ON public.document_generation_jobs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own document jobs" ON public.document_generation_jobs;
CREATE POLICY "Users update own document jobs"
  ON public.document_generation_jobs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users select own document events" ON public.document_generation_events;
CREATE POLICY "Users select own document events"
  ON public.document_generation_events
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own document events" ON public.document_generation_events;
CREATE POLICY "Users insert own document events"
  ON public.document_generation_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
