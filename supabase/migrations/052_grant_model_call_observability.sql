-- Safe per-attempt telemetry for future Grant Edit Session model calls.
-- Stores hashes, identifiers, status and usage only; never sensitive content.

CREATE TABLE IF NOT EXISTS public.grant_model_calls (
  call_id UUID PRIMARY KEY,
  trace_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  session_id UUID,
  turn_id UUID,
  operation TEXT NOT NULL CHECK (operation = 'grant.edit_session.turn'),
  policy_version TEXT NOT NULL CHECK (policy_version = 'grant-edit-session-turn-v1'),
  provider TEXT NOT NULL CHECK (provider = 'openai'),
  model_id TEXT NOT NULL CHECK (length(btrim(model_id)) > 0),
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 2),
  attempt_purpose TEXT NOT NULL CHECK (attempt_purpose IN ('initial', 'schema_repair', 'capacity_retry', 'transient_retry')),
  status TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  output_hash TEXT CHECK (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'),
  provider_request_id TEXT,
  failure_category TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (trace_id, attempt_number),
  CHECK ((status = 'started') = (completed_at IS NULL)),
  CHECK ((status = 'failed') = (failure_category IS NOT NULL)),
  CHECK (status <> 'succeeded' OR output_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS grant_model_calls_trace_idx
  ON public.grant_model_calls (document_id, trace_id, attempt_number);

ALTER TABLE public.grant_model_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_model_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_model_calls TO service_role;

CREATE OR REPLACE FUNCTION public.grant_model_call_json(row_value public.grant_model_calls)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'callId', row_value.call_id, 'traceId', row_value.trace_id,
    'documentId', row_value.document_id, 'sessionId', row_value.session_id,
    'turnId', row_value.turn_id, 'operation', row_value.operation,
    'policyVersion', row_value.policy_version, 'provider', row_value.provider,
    'modelId', row_value.model_id, 'attemptNumber', row_value.attempt_number,
    'attemptPurpose', row_value.attempt_purpose, 'status', row_value.status,
    'inputHash', row_value.input_hash, 'outputHash', row_value.output_hash,
    'providerRequestId', row_value.provider_request_id,
    'failureCategory', row_value.failure_category,
    'inputTokens', row_value.input_tokens, 'outputTokens', row_value.output_tokens,
    'reasoningTokens', row_value.reasoning_tokens, 'startedAt', row_value.started_at,
    'completedAt', row_value.completed_at
  ));
$$;

CREATE OR REPLACE FUNCTION public.start_grant_model_call(p_owner_id UUID, p_attempt JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE stored public.grant_model_calls%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grant_documents WHERE document_id = (p_attempt->>'documentId')::UUID AND owner_id = p_owner_id) THEN
    RAISE EXCEPTION 'grant_document_not_found';
  END IF;
  INSERT INTO public.grant_model_calls (
    call_id, trace_id, document_id, session_id, turn_id, operation, policy_version,
    provider, model_id, attempt_number, attempt_purpose, status, input_hash, started_at
  ) VALUES (
    (p_attempt->>'callId')::UUID, (p_attempt->>'traceId')::UUID,
    (p_attempt->>'documentId')::UUID, NULLIF(p_attempt->>'sessionId', '')::UUID,
    NULLIF(p_attempt->>'turnId', '')::UUID, p_attempt->>'operation',
    p_attempt->>'policyVersion', p_attempt->>'provider', p_attempt->>'modelId',
    (p_attempt->>'attemptNumber')::INTEGER, p_attempt->>'attemptPurpose',
    'started', p_attempt->>'inputHash', (p_attempt->>'startedAt')::TIMESTAMPTZ
  ) RETURNING * INTO stored;
  RETURN public.grant_model_call_json(stored);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_grant_model_call(
  p_owner_id UUID, p_call_id UUID, p_expected_status TEXT, p_status TEXT,
  p_output_hash TEXT, p_provider_request_id TEXT, p_failure_category TEXT,
  p_input_tokens INTEGER, p_output_tokens INTEGER, p_reasoning_tokens INTEGER,
  p_completed_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE stored public.grant_model_calls%ROWTYPE;
BEGIN
  UPDATE public.grant_model_calls AS call SET
    status = p_status, output_hash = p_output_hash,
    provider_request_id = p_provider_request_id, failure_category = p_failure_category,
    input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    reasoning_tokens = p_reasoning_tokens, completed_at = p_completed_at
  FROM public.grant_documents AS document
  WHERE call.call_id = p_call_id AND call.status = p_expected_status
    AND document.document_id = call.document_id AND document.owner_id = p_owner_id
  RETURNING call.* INTO stored;
  IF stored.call_id IS NULL THEN RAISE EXCEPTION 'grant_model_call_status_changed'; END IF;
  RETURN public.grant_model_call_json(stored);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_model_calls_by_trace(p_owner_id UUID, p_document_id UUID, p_trace_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(public.grant_model_call_json(call) ORDER BY call.attempt_number), '[]'::JSONB)
  FROM public.grant_model_calls AS call
  JOIN public.grant_documents AS document ON document.document_id = call.document_id
  WHERE call.document_id = p_document_id AND call.trace_id = p_trace_id AND document.owner_id = p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.start_grant_model_call(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_model_call_json(public.grant_model_calls) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_grant_model_call(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_grant_model_calls_by_trace(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_grant_model_call(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_model_call_json(public.grant_model_calls) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_grant_model_call(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_model_calls_by_trace(UUID, UUID, UUID) TO service_role;
