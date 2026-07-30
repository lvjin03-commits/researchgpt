CREATE TABLE IF NOT EXISTS public.document_v2_model_executions (
  execution_key TEXT PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.document_v2_jobs(id) ON DELETE CASCADE,
  component_key TEXT,
  operation TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('deepseek', 'openai')),
  requested_model_id TEXT NOT NULL,
  resolved_model_id TEXT NOT NULL,
  actual_model_id TEXT,
  provider_request_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  raw_response JSONB,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS document_v2_model_executions_job_idx
  ON public.document_v2_model_executions (job_id, created_at);

ALTER TABLE public.document_v2_model_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_v2_model_executions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.document_v2_model_executions
  TO service_role;
