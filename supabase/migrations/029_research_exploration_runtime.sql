-- Durable execution boundary for optional research exploration jobs.
-- The authoritative Document V2 pipeline never depends on these rows.

CREATE TABLE IF NOT EXISTS public.research_exploration_executions (
  execution_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exploration_id TEXT NOT NULL,
  exploration_revision INTEGER NOT NULL CHECK (exploration_revision > 0),
  execution_revision INTEGER NOT NULL DEFAULT 0 CHECK (execution_revision >= 0),
  document_job_id UUID,
  requirement TEXT NOT NULL DEFAULT 'optional'
    CHECK (requirement IN ('optional', 'required')),
  adapter TEXT NOT NULL DEFAULT 'storm' CHECK (adapter = 'storm'),
  versions JSONB NOT NULL,
  input_fingerprint TEXT NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  input_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'running', 'partial', 'complete', 'failed',
      'unknown_outcome', 'expired', 'cancelled'
    )),
  phase TEXT NOT NULL DEFAULT 'queued',
  remote_execution_id TEXT,
  result_location TEXT,
  result_payload JSONB,
  failure JSONB,
  next_check_at TIMESTAMPTZ,
  inspection_count INTEGER NOT NULL DEFAULT 0 CHECK (inspection_count >= 0),
  maximum_inspection_count INTEGER NOT NULL CHECK (maximum_inspection_count > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_token BIGINT NOT NULL DEFAULT 0 CHECK (lease_token >= 0),
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  recovery_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_id, exploration_id),
  UNIQUE (owner_id, input_fingerprint)
);

CREATE INDEX IF NOT EXISTS research_exploration_status_lease_idx
  ON public.research_exploration_executions (status, lease_expires_at);
CREATE INDEX IF NOT EXISTS research_exploration_document_job_idx
  ON public.research_exploration_executions (document_job_id, created_at DESC)
  WHERE document_job_id IS NOT NULL;

ALTER TABLE public.research_exploration_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.research_exploration_executions
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.research_exploration_executions
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_research_exploration_execution(
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF public.research_exploration_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF length(trim(p_lease_owner)) = 0 THEN
    RAISE EXCEPTION 'lease owner is required';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'lease seconds must be between 30 and 600';
  END IF;

  RETURN QUERY
  UPDATE public.research_exploration_executions AS execution
  SET
    status = 'running',
    phase = 'research',
    remote_execution_id = execution.execution_id::TEXT,
    execution_revision = execution.execution_revision + 1,
    lease_owner = p_lease_owner,
    lease_token = execution.lease_token + 1,
    lease_expires_at = claimed_at + make_interval(secs => p_lease_seconds),
    heartbeat_at = claimed_at,
    recovery_count = execution.recovery_count +
      CASE WHEN execution.status = 'running' THEN 1 ELSE 0 END,
    updated_at = claimed_at
  WHERE execution.execution_id = p_execution_id
    AND execution.expires_at > claimed_at
    AND execution.recovery_count < 3
    AND (
      execution.status = 'queued'
      OR (
        execution.status = 'running'
        AND execution.lease_expires_at < claimed_at - interval '30 seconds'
      )
    )
  RETURNING execution.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_research_exploration_execution(
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token BIGINT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
  heartbeat_time TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE public.research_exploration_executions
  SET
    heartbeat_at = heartbeat_time,
    lease_expires_at = heartbeat_time + make_interval(secs => p_lease_seconds),
    updated_at = heartbeat_time
  WHERE execution_id = p_execution_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_token = p_lease_token;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_research_exploration_execution(
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token BIGINT,
  p_status TEXT,
  p_result JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
  completed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_status NOT IN ('complete', 'partial') THEN
    RAISE EXCEPTION 'completion status must be complete or partial';
  END IF;
  UPDATE public.research_exploration_executions
  SET
    status = p_status,
    phase = CASE WHEN p_status = 'complete' THEN 'complete' ELSE 'partial' END,
    result_location = 'research-exploration://' || execution_id::TEXT || '/result-v1',
    result_payload = p_result,
    failure = NULL,
    execution_revision = execution_revision + 1,
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = completed_at,
    updated_at = completed_at
  WHERE execution_id = p_execution_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_token = p_lease_token;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_research_exploration_execution(
  p_execution_id UUID,
  p_lease_owner TEXT,
  p_lease_token BIGINT,
  p_failure JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
  failed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  UPDATE public.research_exploration_executions
  SET
    status = 'failed',
    phase = 'failed',
    failure = p_failure,
    execution_revision = execution_revision + 1,
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = failed_at,
    updated_at = failed_at
  WHERE execution_id = p_execution_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_token = p_lease_token;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_research_exploration_execution(UUID, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_research_exploration_execution(UUID, TEXT, BIGINT, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_research_exploration_execution(UUID, TEXT, BIGINT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_research_exploration_execution(UUID, TEXT, BIGINT, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_research_exploration_execution(UUID, TEXT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_research_exploration_execution(UUID, TEXT, BIGINT, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_research_exploration_execution(UUID, TEXT, BIGINT, TEXT, JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_research_exploration_execution(UUID, TEXT, BIGINT, JSONB)
  TO service_role;

COMMENT ON TABLE public.research_exploration_executions IS
  'Optional, non-authoritative STORM exploration executions. Document V2 delivery never waits on this table.';
