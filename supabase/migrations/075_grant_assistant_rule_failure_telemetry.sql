-- Extend existing Grant Model Executor telemetry with safe rule-level failure
-- attribution. Historical attempts remain valid with NULL reason fields.

ALTER TABLE public.grant_model_calls
  ADD COLUMN IF NOT EXISTS failure_reason_contract_version TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS failure_component TEXT,
  ADD COLUMN IF NOT EXISTS failure_reason_facts JSONB;

CREATE OR REPLACE FUNCTION public.grant_model_failure_reason_facts_safe(facts JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT facts IS NULL OR (
    jsonb_typeof(facts) = 'object'
    AND octet_length(facts::TEXT) <= 2048
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(facts) AS entry(key, value)
      WHERE key NOT IN (
        'maximumInputTokens', 'requiredInputTokens', 'selectedTargetCount',
        'availableTargetCount', 'admittedSourceCount', 'claimCount',
        'citationCount', 'completedUnitCount', 'totalUnitCount',
        'attemptNumber', 'providerStatusCode', 'requestDispatched',
        'usageKnown', 'hasClarificationQuestion'
      )
      OR CASE
        WHEN key IN ('requestDispatched', 'usageKnown', 'hasClarificationQuestion')
          THEN jsonb_typeof(value) <> 'boolean'
        ELSE jsonb_typeof(value) <> 'number' OR (value #>> '{}') !~ '^\d+$'
      END
    )
  );
$$;

ALTER TABLE public.grant_model_calls
  DROP CONSTRAINT IF EXISTS grant_model_calls_failure_reason_shape_check,
  DROP CONSTRAINT IF EXISTS grant_model_calls_failure_reason_code_check,
  DROP CONSTRAINT IF EXISTS grant_model_calls_failure_component_check,
  DROP CONSTRAINT IF EXISTS grant_model_calls_failure_reason_facts_check,
  DROP CONSTRAINT IF EXISTS grant_model_calls_failure_reason_status_check;

ALTER TABLE public.grant_model_calls
  ADD CONSTRAINT grant_model_calls_failure_reason_shape_check CHECK (
    (failure_reason_contract_version IS NULL AND failure_reason_code IS NULL AND failure_component IS NULL)
    OR
    (failure_reason_contract_version = 'grant-assistant-failure-reason-v1'
      AND failure_reason_code IS NOT NULL AND failure_component IS NOT NULL)
  ),
  ADD CONSTRAINT grant_model_calls_failure_reason_code_check CHECK (
    failure_reason_code IS NULL OR failure_reason_code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  ),
  ADD CONSTRAINT grant_model_calls_failure_component_check CHECK (
    failure_component IS NULL OR failure_component IN (
      'document_memory', 'semantic_planner', 'context_budget', 'planned_context',
      'hierarchical_review', 'grounded_answer_validator', 'model_adapter',
      'model_executor', 'persistence'
    )
  ),
  ADD CONSTRAINT grant_model_calls_failure_reason_facts_check CHECK (
    public.grant_model_failure_reason_facts_safe(failure_reason_facts)
  ),
  ADD CONSTRAINT grant_model_calls_failure_reason_status_check CHECK (
    failure_reason_code IS NULL OR status = 'failed'
  );

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
    'providerRequestIds', to_jsonb(row_value.provider_request_ids),
    'failureCategory', row_value.failure_category,
    'failureStage', row_value.failure_stage,
    'failureReason', CASE WHEN row_value.failure_reason_code IS NULL THEN NULL ELSE
      jsonb_build_object(
        'contractVersion', row_value.failure_reason_contract_version,
        'reasonCode', row_value.failure_reason_code,
        'component', row_value.failure_component,
        'category', row_value.failure_category,
        'stage', row_value.failure_stage,
        'safeFacts', COALESCE(row_value.failure_reason_facts, '{}'::JSONB)
      ) END,
    'requestDispatched', row_value.request_dispatched,
    'usageKnown', row_value.usage_known,
    'contextManifestHash', row_value.context_manifest_hash,
    'inputTokens', row_value.input_tokens, 'outputTokens', row_value.output_tokens,
    'reasoningTokens', row_value.reasoning_tokens, 'startedAt', row_value.started_at,
    'completedAt', row_value.completed_at
  ));
$$;

DROP FUNCTION IF EXISTS public.finish_grant_model_call(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, BOOLEAN,
  BOOLEAN, TEXT, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.finish_grant_model_call(
  p_owner_id UUID, p_call_id UUID, p_expected_status TEXT, p_status TEXT,
  p_output_hash TEXT, p_provider_request_id TEXT, p_provider_request_ids TEXT[],
  p_failure_category TEXT, p_failure_stage TEXT,
  p_failure_reason_contract_version TEXT, p_failure_reason_code TEXT,
  p_failure_component TEXT, p_failure_reason_facts JSONB,
  p_request_dispatched BOOLEAN, p_usage_known BOOLEAN, p_context_manifest_hash TEXT,
  p_input_tokens INTEGER, p_output_tokens INTEGER, p_reasoning_tokens INTEGER,
  p_completed_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE stored public.grant_model_calls%ROWTYPE;
BEGIN
  UPDATE public.grant_model_calls AS call SET
    status = p_status, output_hash = p_output_hash,
    provider_request_id = p_provider_request_id,
    provider_request_ids = p_provider_request_ids,
    failure_category = p_failure_category,
    failure_stage = p_failure_stage,
    failure_reason_contract_version = p_failure_reason_contract_version,
    failure_reason_code = p_failure_reason_code,
    failure_component = p_failure_component,
    failure_reason_facts = p_failure_reason_facts,
    request_dispatched = p_request_dispatched,
    usage_known = p_usage_known,
    context_manifest_hash = p_context_manifest_hash,
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

REVOKE ALL ON FUNCTION public.finish_grant_model_call(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT,
  TEXT, TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN, TEXT,
  INTEGER, INTEGER, INTEGER, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_grant_model_call(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT,
  TEXT, TEXT, TEXT, JSONB, BOOLEAN, BOOLEAN, TEXT,
  INTEGER, INTEGER, INTEGER, TIMESTAMPTZ
) TO service_role;
