-- Durable, Revision-bound checkpoints for Grant Assistant composite executions.
-- The checkpoint is content-bearing and is only exposed through owner-checked RPCs.

CREATE TABLE IF NOT EXISTS public.grant_assistant_executions (
  execution_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  turn_id UUID NOT NULL,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id) ON DELETE CASCADE,
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  policy_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'failed', 'completed')),
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  checkpoint JSONB NOT NULL DEFAULT '{"schemaVersion":"grant-assistant-execution-checkpoint-v1"}'::JSONB,
  failure_reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (document_id, turn_id),
  CHECK (checkpoint ->> 'schemaVersion' = 'grant-assistant-execution-checkpoint-v1'),
  CHECK (octet_length(checkpoint::TEXT) <= 2097152),
  CHECK (failure_reason_code IS NULL OR failure_reason_code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

CREATE INDEX IF NOT EXISTS grant_assistant_executions_document_status_idx
  ON public.grant_assistant_executions(document_id, status, updated_at DESC);

ALTER TABLE public.grant_assistant_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_assistant_executions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.grant_assistant_executions TO service_role;

CREATE OR REPLACE FUNCTION public.grant_assistant_execution_json(row_value public.grant_assistant_executions)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'executionId', row_value.execution_id, 'documentId', row_value.document_id,
    'turnId', row_value.turn_id, 'sourceRevisionId', row_value.source_revision_id,
    'inputHash', row_value.input_hash, 'policyVersion', row_value.policy_version,
    'modelId', row_value.model_id, 'status', row_value.status, 'version', row_value.version,
    'leaseToken', row_value.lease_token, 'leaseExpiresAt', row_value.lease_expires_at,
    'checkpoint', row_value.checkpoint, 'failureReasonCode', row_value.failure_reason_code,
    'createdAt', row_value.created_at, 'updatedAt', row_value.updated_at
  );
$$;

CREATE OR REPLACE FUNCTION public.claim_grant_assistant_execution(
  p_owner_id UUID, p_execution_id UUID, p_document_id UUID, p_turn_id UUID,
  p_source_revision_id UUID, p_input_hash TEXT, p_policy_version TEXT, p_model_id TEXT,
  p_lease_token UUID, p_now TIMESTAMPTZ, p_lease_expires_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE stored public.grant_assistant_executions%ROWTYPE; acquired BOOLEAN := FALSE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grant_documents
    WHERE document_id = p_document_id AND owner_id = p_owner_id) THEN
    RAISE EXCEPTION 'grant_document_not_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.grant_document_revisions
    WHERE revision_id = p_source_revision_id AND document_id = p_document_id) THEN
    RAISE EXCEPTION 'grant_revision_not_found';
  END IF;
  IF p_lease_expires_at <= p_now THEN RAISE EXCEPTION 'grant_assistant_execution_invalid_lease'; END IF;

  INSERT INTO public.grant_assistant_executions(
    execution_id, document_id, turn_id, source_revision_id, input_hash, policy_version,
    model_id, status, version, lease_token, lease_expires_at, checkpoint, created_at, updated_at
  ) VALUES (
    p_execution_id, p_document_id, p_turn_id, p_source_revision_id, p_input_hash, p_policy_version,
    p_model_id, 'running', 0, p_lease_token, p_lease_expires_at,
    '{"schemaVersion":"grant-assistant-execution-checkpoint-v1"}'::JSONB, p_now, p_now
  ) ON CONFLICT (document_id, turn_id) DO NOTHING;
  acquired := FOUND;

  SELECT execution.* INTO stored FROM public.grant_assistant_executions AS execution
  WHERE execution.document_id = p_document_id AND execution.turn_id = p_turn_id FOR UPDATE;
  IF stored.input_hash <> p_input_hash OR stored.source_revision_id <> p_source_revision_id OR
    stored.policy_version <> p_policy_version OR stored.model_id <> p_model_id THEN
    RAISE EXCEPTION 'grant_assistant_execution_identity_mismatch';
  END IF;

  IF NOT acquired AND stored.status <> 'completed' AND
    (stored.status = 'failed' OR stored.lease_expires_at IS NULL OR stored.lease_expires_at < p_now OR
      stored.lease_token = p_lease_token) THEN
    UPDATE public.grant_assistant_executions SET status = 'running', version = version + 1,
      lease_token = p_lease_token, lease_expires_at = p_lease_expires_at,
      failure_reason_code = NULL, updated_at = p_now
    WHERE execution_id = stored.execution_id RETURNING * INTO stored;
    acquired := TRUE;
  END IF;
  RETURN jsonb_build_object('claimed', acquired, 'execution', public.grant_assistant_execution_json(stored));
END;
$$;

CREATE OR REPLACE FUNCTION public.save_grant_assistant_execution(
  p_owner_id UUID, p_execution_id UUID, p_expected_version INTEGER, p_lease_token UUID,
  p_status TEXT, p_checkpoint JSONB, p_failure_reason_code TEXT, p_now TIMESTAMPTZ,
  p_lease_expires_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE stored public.grant_assistant_executions%ROWTYPE;
BEGIN
  UPDATE public.grant_assistant_executions AS execution SET
    status = p_status, version = execution.version + 1, checkpoint = p_checkpoint,
    failure_reason_code = p_failure_reason_code, updated_at = p_now,
    lease_token = CASE WHEN p_status = 'running' THEN p_lease_token ELSE NULL END,
    lease_expires_at = CASE WHEN p_status = 'running' THEN p_lease_expires_at ELSE NULL END
  FROM public.grant_documents AS document
  WHERE execution.execution_id = p_execution_id AND execution.version = p_expected_version
    AND execution.lease_token = p_lease_token AND document.document_id = execution.document_id
    AND document.owner_id = p_owner_id
  RETURNING execution.* INTO stored;
  IF stored.execution_id IS NULL THEN RAISE EXCEPTION 'grant_assistant_execution_version_changed'; END IF;
  RETURN public.grant_assistant_execution_json(stored);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_grant_assistant_execution(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_grant_assistant_execution(UUID, UUID, INTEGER, UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_grant_assistant_execution(UUID, UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_grant_assistant_execution(UUID, UUID, INTEGER, UUID, TEXT, JSONB, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
