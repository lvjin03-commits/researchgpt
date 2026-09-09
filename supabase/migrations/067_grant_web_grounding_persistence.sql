-- Metadata-only web grounding persistence. Public source content is reusable;
-- document search/use behavior remains owner-scoped and service-role-only.

CREATE TABLE public.grant_web_public_sources (
  content_fingerprint TEXT PRIMARY KEY CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_url TEXT NOT NULL,
  payload JSONB NOT NULL,
  first_retrieved_at TIMESTAMPTZ NOT NULL,
  last_retrieved_at TIMESTAMPTZ NOT NULL CHECK (last_retrieved_at >= first_retrieved_at)
);

CREATE TABLE public.grant_web_search_egress_audits (
  audit_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  actor_id UUID NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('openalex','google_custom_search')),
  policy_version TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allowed','blocked')),
  candidate_hash TEXT NOT NULL CHECK (candidate_hash ~ '^[a-f0-9]{64}$'),
  outgoing_query TEXT CHECK (outgoing_query IS NULL OR (length(btrim(outgoing_query)) BETWEEN 2 AND 160)),
  issues JSONB NOT NULL CHECK (jsonb_typeof(issues)='array'),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (decision='allowed' AND outgoing_query IS NOT NULL AND jsonb_array_length(issues)=0)
    OR (decision='blocked' AND outgoing_query IS NULL AND jsonb_array_length(issues)>0)
  )
);

CREATE TABLE public.grant_web_source_usage_events (
  usage_event_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  assistant_session_id UUID REFERENCES public.grant_assistant_sessions(session_id) ON DELETE CASCADE,
  turn_id UUID NOT NULL,
  search_audit_id UUID NOT NULL REFERENCES public.grant_web_search_egress_audits(audit_id) ON DELETE CASCADE,
  source_id UUID NOT NULL,
  content_fingerprint TEXT NOT NULL REFERENCES public.grant_web_public_sources(content_fingerprint),
  event_type TEXT NOT NULL CHECK (event_type IN ('retrieved','recommended','excluded','cited')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(document_id,turn_id,source_id,event_type)
);

CREATE INDEX grant_web_egress_document_idx ON public.grant_web_search_egress_audits(document_id,created_at DESC);
CREATE INDEX grant_web_usage_turn_idx ON public.grant_web_source_usage_events(document_id,turn_id,created_at);
ALTER TABLE public.grant_web_public_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_web_search_egress_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_web_source_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grant_web_public_sources,public.grant_web_search_egress_audits,public.grant_web_source_usage_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.grant_web_public_sources TO service_role;
GRANT SELECT,INSERT ON public.grant_web_search_egress_audits,public.grant_web_source_usage_events TO service_role;

CREATE FUNCTION public.append_grant_web_search_egress_audit(p_owner_id UUID,p_event JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.grant_documents WHERE document_id=(p_event->>'documentId')::uuid AND owner_id=p_owner_id)
    THEN RAISE EXCEPTION 'grant_document_not_found'; END IF;
  INSERT INTO public.grant_web_search_egress_audits VALUES(
    (p_event->>'auditId')::uuid,(p_event->>'documentId')::uuid,(p_event->>'sourceRevision')::integer,
    (p_event->>'actorId')::uuid,p_event->>'providerId',p_event->>'policyVersion',p_event->>'decision',
    p_event->>'candidateHash',p_event->>'outgoingQuery',p_event->'issues',(p_event->>'createdAt')::timestamptz);
END; $$;

CREATE FUNCTION public.save_grant_web_search_results(p_owner_id UUID,p_document_id UUID,p_search_audit_id UUID,p_sources JSONB,p_usage_events JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE item JSONB; BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.grant_documents WHERE document_id=p_document_id AND owner_id=p_owner_id)
    THEN RAISE EXCEPTION 'grant_document_not_found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.grant_web_search_egress_audits WHERE audit_id=p_search_audit_id AND document_id=p_document_id AND decision='allowed')
    THEN RAISE EXCEPTION 'grant_web_search_audit_invalid'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_sources) LOOP
    INSERT INTO public.grant_web_public_sources(content_fingerprint,canonical_url,payload,first_retrieved_at,last_retrieved_at)
    VALUES(item->>'contentFingerprint',item->>'canonicalUrl',item-'sourceId'-'retrievedAt',(item->>'retrievedAt')::timestamptz,(item->>'retrievedAt')::timestamptz)
    ON CONFLICT(content_fingerprint) DO UPDATE SET last_retrieved_at=GREATEST(public.grant_web_public_sources.last_retrieved_at,EXCLUDED.last_retrieved_at);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_usage_events) LOOP
    IF (item->>'documentId')::uuid<>p_document_id OR (item->>'searchAuditId')::uuid<>p_search_audit_id OR item->>'eventType'<>'retrieved'
      THEN RAISE EXCEPTION 'grant_web_usage_scope_invalid'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_sources) source
      WHERE (source->>'sourceId')::uuid=(item->>'sourceId')::uuid
        AND source->>'contentFingerprint'=item->>'contentFingerprint')
      THEN RAISE EXCEPTION 'grant_web_usage_source_invalid'; END IF;
    IF item->>'assistantSessionId' IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.grant_assistant_sessions session
      WHERE session.session_id=(item->>'assistantSessionId')::uuid AND session.document_id=p_document_id)
      THEN RAISE EXCEPTION 'grant_web_usage_session_invalid'; END IF;
    INSERT INTO public.grant_web_source_usage_events VALUES(
      (item->>'usageEventId')::uuid,p_document_id,NULLIF(item->>'assistantSessionId','')::uuid,(item->>'turnId')::uuid,
      p_search_audit_id,(item->>'sourceId')::uuid,item->>'contentFingerprint',item->>'eventType',(item->>'createdAt')::timestamptz);
  END LOOP;
END; $$;

CREATE FUNCTION public.append_grant_web_source_usage_events(p_owner_id UUID,p_document_id UUID,p_usage_events JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE item JSONB; BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.grant_documents WHERE document_id=p_document_id AND owner_id=p_owner_id)
    THEN RAISE EXCEPTION 'grant_document_not_found'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_usage_events) LOOP
    IF (item->>'documentId')::uuid<>p_document_id OR item->>'eventType'='retrieved'
      THEN RAISE EXCEPTION 'grant_web_usage_scope_invalid'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.grant_web_search_egress_audits WHERE audit_id=(item->>'searchAuditId')::uuid AND document_id=p_document_id)
      THEN RAISE EXCEPTION 'grant_web_search_audit_invalid'; END IF;
    IF item->>'assistantSessionId' IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.grant_assistant_sessions session
      WHERE session.session_id=(item->>'assistantSessionId')::uuid AND session.document_id=p_document_id)
      THEN RAISE EXCEPTION 'grant_web_usage_session_invalid'; END IF;
    IF NOT EXISTS(SELECT 1 FROM public.grant_web_source_usage_events prior
      WHERE prior.document_id=p_document_id AND prior.turn_id=(item->>'turnId')::uuid
        AND prior.search_audit_id=(item->>'searchAuditId')::uuid
        AND prior.source_id=(item->>'sourceId')::uuid
        AND prior.content_fingerprint=item->>'contentFingerprint' AND prior.event_type='retrieved')
      THEN RAISE EXCEPTION 'grant_web_usage_source_not_retrieved'; END IF;
    INSERT INTO public.grant_web_source_usage_events VALUES(
      (item->>'usageEventId')::uuid,p_document_id,NULLIF(item->>'assistantSessionId','')::uuid,(item->>'turnId')::uuid,
      (item->>'searchAuditId')::uuid,(item->>'sourceId')::uuid,item->>'contentFingerprint',item->>'eventType',(item->>'createdAt')::timestamptz);
  END LOOP;
END; $$;

CREATE FUNCTION public.list_grant_web_turn_sources(p_owner_id UUID,p_document_id UUID,p_turn_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source',source.payload||jsonb_build_object('sourceId',event.source_id,'retrievedAt',event.created_at),
    'eventType',event.event_type) ORDER BY event.created_at,event.usage_event_id),'[]'::jsonb)
  FROM public.grant_web_source_usage_events event
  JOIN public.grant_web_public_sources source ON source.content_fingerprint=event.content_fingerprint
  JOIN public.grant_documents document ON document.document_id=event.document_id
  WHERE event.document_id=p_document_id AND event.turn_id=p_turn_id AND document.owner_id=p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.append_grant_web_search_egress_audit(UUID,JSONB),public.save_grant_web_search_results(UUID,UUID,UUID,JSONB,JSONB),public.append_grant_web_source_usage_events(UUID,UUID,JSONB),public.list_grant_web_turn_sources(UUID,UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_grant_web_search_egress_audit(UUID,JSONB),public.save_grant_web_search_results(UUID,UUID,UUID,JSONB,JSONB),public.append_grant_web_source_usage_events(UUID,UUID,JSONB),public.list_grant_web_turn_sources(UUID,UUID,UUID) TO service_role;

-- Admit only the two new model stages to the existing telemetry authority.
-- Legacy explanation values remain valid for historical rows but are not executable.
ALTER TABLE public.grant_model_calls DROP CONSTRAINT IF EXISTS grant_model_calls_operation_check,DROP CONSTRAINT IF EXISTS grant_model_calls_policy_version_check;
ALTER TABLE public.grant_model_calls
  ADD CONSTRAINT grant_model_calls_operation_check CHECK(operation IN ('grant.edit_session.turn','grant.assistant.chat','grant.edit_candidate.explain','grant.web_query.rewrite','grant.web_source.assess','grant.web_answer.synthesize')),
  ADD CONSTRAINT grant_model_calls_policy_version_check CHECK(
    (operation='grant.edit_session.turn' AND policy_version='grant-edit-session-turn-v1') OR
    (operation='grant.assistant.chat' AND policy_version='grant-assistant-chat-v1') OR
    (operation='grant.edit_candidate.explain' AND policy_version='grant-edit-candidate-explain-v1') OR
    (operation='grant.web_query.rewrite' AND policy_version='grant-web-query-rewrite-v1') OR
    (operation='grant.web_source.assess' AND policy_version='grant-web-source-assess-v1') OR
    (operation='grant.web_answer.synthesize' AND policy_version='grant-web-answer-synthesize-v1'));
