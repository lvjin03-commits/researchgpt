-- User-confirmed web discovery metadata and immutable snapshot provenance.
CREATE TABLE IF NOT EXISTS public.grant_web_search_sessions (
  search_session_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS public.grant_web_source_snapshots (
  snapshot_id UUID PRIMARY KEY,
  search_session_id UUID NOT NULL REFERENCES public.grant_web_search_sessions(search_session_id) ON DELETE CASCADE,
  result_id UUID NOT NULL,
  evidence_source_id UUID NOT NULL,
  payload JSONB NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  UNIQUE(search_session_id,result_id)
);
CREATE INDEX IF NOT EXISTS grant_web_search_document_idx ON public.grant_web_search_sessions(document_id,created_at DESC);
ALTER TABLE public.grant_web_search_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_web_source_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grant_web_search_sessions,public.grant_web_source_snapshots FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.grant_web_search_sessions,public.grant_web_source_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.create_grant_web_search_session(p_owner_id UUID,p_session JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.grant_documents WHERE document_id=(p_session->>'documentId')::UUID AND owner_id=p_owner_id) THEN RAISE EXCEPTION 'grant_document_not_found'; END IF;
 INSERT INTO public.grant_web_search_sessions VALUES((p_session->>'searchSessionId')::UUID,(p_session->>'documentId')::UUID,p_session,(p_session->>'createdAt')::TIMESTAMPTZ,(p_session->>'expiresAt')::TIMESTAMPTZ);
END; $$;
CREATE OR REPLACE FUNCTION public.get_grant_web_search_session(p_owner_id UUID,p_search_session_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT search.payload FROM public.grant_web_search_sessions search JOIN public.grant_documents document ON document.document_id=search.document_id WHERE search.search_session_id=p_search_session_id AND document.owner_id=p_owner_id; $$;
CREATE OR REPLACE FUNCTION public.save_grant_web_source_snapshots(p_owner_id UUID,p_search_session_id UUID,p_snapshots JSONB,p_status TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE item JSONB; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.grant_web_search_sessions search JOIN public.grant_documents document ON document.document_id=search.document_id WHERE search.search_session_id=p_search_session_id AND document.owner_id=p_owner_id) THEN RAISE EXCEPTION 'grant_web_search_not_found'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_snapshots) LOOP
  INSERT INTO public.grant_web_source_snapshots(snapshot_id,search_session_id,result_id,evidence_source_id,payload,captured_at) VALUES((item->>'snapshotId')::UUID,p_search_session_id,(item->>'resultId')::UUID,(item->>'evidenceSourceId')::UUID,item,(item->>'capturedAt')::TIMESTAMPTZ) ON CONFLICT(search_session_id,result_id) DO UPDATE SET payload=EXCLUDED.payload;
 END LOOP;
 UPDATE public.grant_web_search_sessions SET payload=jsonb_set(payload,'{status}',to_jsonb(p_status)) WHERE search_session_id=p_search_session_id;
END; $$;
CREATE OR REPLACE FUNCTION public.list_grant_web_source_snapshots(p_owner_id UUID,p_search_session_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT COALESCE(jsonb_agg(snapshot.payload ORDER BY snapshot.captured_at),'[]'::jsonb) FROM public.grant_web_source_snapshots snapshot JOIN public.grant_web_search_sessions search ON search.search_session_id=snapshot.search_session_id JOIN public.grant_documents document ON document.document_id=search.document_id WHERE snapshot.search_session_id=p_search_session_id AND document.owner_id=p_owner_id; $$;
REVOKE ALL ON FUNCTION public.create_grant_web_search_session(UUID,JSONB),public.get_grant_web_search_session(UUID,UUID),public.save_grant_web_source_snapshots(UUID,UUID,JSONB,TEXT),public.list_grant_web_source_snapshots(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_grant_web_search_session(UUID,JSONB),public.get_grant_web_search_session(UUID,UUID),public.save_grant_web_source_snapshots(UUID,UUID,JSONB,TEXT),public.list_grant_web_source_snapshots(UUID,UUID) TO service_role;

