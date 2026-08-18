-- Deterministic Candidate explanation cache and single-flight lease. The table
-- stores a read-only projection; it has no Patch or Revision foreign authority.

CREATE TABLE public.grant_candidate_explanations (
  cache_key TEXT PRIMARY KEY CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  owner_id UUID NOT NULL,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.grant_ai_edit_sessions(session_id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES public.grant_ai_edit_candidates(candidate_id) ON DELETE CASCADE,
  diff_hash TEXT NOT NULL CHECK (diff_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  trace_id UUID NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  explanation JSONB,
  failure_category TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX grant_candidate_explanations_candidate_idx
  ON public.grant_candidate_explanations(document_id, session_id, candidate_id);

ALTER TABLE public.grant_candidate_explanations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grant_candidate_explanations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grant_candidate_explanations TO service_role;

CREATE OR REPLACE FUNCTION public.claim_grant_candidate_explanation(p_owner_id UUID, p_claim JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE stored public.grant_candidate_explanations%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.grant_ai_edit_candidates candidate
    JOIN public.grant_ai_edit_sessions session ON session.session_id=candidate.session_id
    JOIN public.grant_documents document ON document.document_id=session.document_id
    WHERE candidate.candidate_id=(p_claim->>'candidateId')::uuid
      AND session.session_id=(p_claim->>'sessionId')::uuid
      AND document.document_id=(p_claim->>'documentId')::uuid
      AND document.owner_id=p_owner_id
  ) THEN RAISE EXCEPTION 'grant_candidate_explanation_scope_invalid'; END IF;

  INSERT INTO public.grant_candidate_explanations(
    cache_key,owner_id,document_id,session_id,candidate_id,diff_hash,status,
    trace_id,lease_expires_at,created_at,updated_at
  ) VALUES (
    p_claim->>'cacheKey',p_owner_id,(p_claim->>'documentId')::uuid,
    (p_claim->>'sessionId')::uuid,(p_claim->>'candidateId')::uuid,
    p_claim->>'diffHash','running',(p_claim->>'traceId')::uuid,
    (p_claim->>'leaseExpiresAt')::timestamptz,(p_claim->>'claimedAt')::timestamptz,
    (p_claim->>'claimedAt')::timestamptz
  ) ON CONFLICT (cache_key) DO NOTHING;

  SELECT * INTO stored FROM public.grant_candidate_explanations
    WHERE cache_key=p_claim->>'cacheKey' AND owner_id=p_owner_id FOR UPDATE;
  IF stored.cache_key IS NULL THEN RAISE EXCEPTION 'grant_candidate_explanation_not_found'; END IF;
  IF stored.status='completed' THEN
    RETURN jsonb_build_object('state','completed','traceId',stored.trace_id,'explanation',stored.explanation);
  END IF;
  IF stored.status='running'
    AND stored.trace_id<>(p_claim->>'traceId')::uuid
    AND stored.lease_expires_at>(p_claim->>'claimedAt')::timestamptz THEN
    RETURN jsonb_build_object('state','in_progress');
  END IF;
  UPDATE public.grant_candidate_explanations SET
    status='running',trace_id=(p_claim->>'traceId')::uuid,
    lease_expires_at=(p_claim->>'leaseExpiresAt')::timestamptz,
    failure_category=NULL,updated_at=(p_claim->>'claimedAt')::timestamptz
    WHERE cache_key=stored.cache_key;
  RETURN jsonb_build_object('state','acquired');
END; $$;

CREATE OR REPLACE FUNCTION public.complete_grant_candidate_explanation(p_owner_id UUID, p_completion JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.grant_candidate_explanations SET
    status='completed',explanation=p_completion->'explanation',
    completed_at=(p_completion->>'completedAt')::timestamptz,
    updated_at=(p_completion->>'completedAt')::timestamptz
  WHERE cache_key=p_completion->>'cacheKey' AND owner_id=p_owner_id
    AND status='running' AND trace_id=(p_completion->>'traceId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_candidate_explanation_lease_changed'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_grant_candidate_explanation(p_owner_id UUID, p_failure JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.grant_candidate_explanations SET
    status='failed',failure_category=p_failure->>'failureCategory',
    updated_at=(p_failure->>'failedAt')::timestamptz
  WHERE cache_key=p_failure->>'cacheKey' AND owner_id=p_owner_id
    AND status='running' AND trace_id=(p_failure->>'traceId')::uuid;
END; $$;

REVOKE ALL ON FUNCTION public.claim_grant_candidate_explanation(UUID,JSONB), public.complete_grant_candidate_explanation(UUID,JSONB), public.fail_grant_candidate_explanation(UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_grant_candidate_explanation(UUID,JSONB), public.complete_grant_candidate_explanation(UUID,JSONB), public.fail_grant_candidate_explanation(UUID,JSONB) TO service_role;
