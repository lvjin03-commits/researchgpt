-- Proposal-only GPT-style Grant edit sessions. Canonical writes remain owned by Revision Service.

CREATE TABLE IF NOT EXISTS public.grant_ai_edit_sessions (
  session_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS public.grant_ai_edit_turns (
  turn_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.grant_ai_edit_sessions(session_id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS public.grant_ai_edit_candidates (
  candidate_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.grant_ai_edit_sessions(session_id) ON DELETE CASCADE,
  produced_by_turn_id UUID NOT NULL REFERENCES public.grant_ai_edit_turns(turn_id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS grant_ai_edit_sessions_document_idx ON public.grant_ai_edit_sessions(document_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS grant_ai_edit_turns_session_idx ON public.grant_ai_edit_turns(session_id, created_at);
CREATE INDEX IF NOT EXISTS grant_ai_edit_candidates_session_idx ON public.grant_ai_edit_candidates(session_id, created_at);

ALTER TABLE public.grant_ai_edit_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_ai_edit_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_ai_edit_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grant_ai_edit_sessions, public.grant_ai_edit_turns, public.grant_ai_edit_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.grant_ai_edit_sessions, public.grant_ai_edit_turns, public.grant_ai_edit_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.create_grant_ai_edit_session(p_owner_id UUID, p_session JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grant_documents WHERE document_id=(p_session->>'documentId')::UUID AND owner_id=p_owner_id) THEN RAISE EXCEPTION 'grant_document_not_found'; END IF;
  INSERT INTO public.grant_ai_edit_sessions(session_id, document_id, payload, created_at, updated_at)
  VALUES ((p_session->>'sessionId')::UUID, (p_session->>'documentId')::UUID, p_session, (p_session->>'createdAt')::TIMESTAMPTZ, (p_session->>'lastActiveAt')::TIMESTAMPTZ);
END; $$;

CREATE OR REPLACE FUNCTION public.get_grant_ai_edit_session(p_owner_id UUID, p_session_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT session.payload FROM public.grant_ai_edit_sessions session JOIN public.grant_documents document ON document.document_id=session.document_id
  WHERE session.session_id=p_session_id AND document.owner_id=p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.create_grant_ai_edit_turn(p_owner_id UUID, p_turn JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grant_ai_edit_sessions session JOIN public.grant_documents document ON document.document_id=session.document_id WHERE session.session_id=(p_turn->>'sessionId')::UUID AND document.owner_id=p_owner_id) THEN RAISE EXCEPTION 'grant_edit_session_not_found'; END IF;
  INSERT INTO public.grant_ai_edit_turns(turn_id,session_id,payload,created_at) VALUES ((p_turn->>'turnId')::UUID,(p_turn->>'sessionId')::UUID,p_turn,(p_turn->>'createdAt')::TIMESTAMPTZ);
END; $$;

CREATE OR REPLACE FUNCTION public.complete_grant_ai_edit_turn(p_owner_id UUID, p_turn_id UUID, p_completed_at TIMESTAMPTZ, p_candidate JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session_id UUID; v_state TEXT;
BEGIN
  SELECT turn.session_id INTO v_session_id FROM public.grant_ai_edit_turns turn JOIN public.grant_ai_edit_sessions session ON session.session_id=turn.session_id JOIN public.grant_documents document ON document.document_id=session.document_id WHERE turn.turn_id=p_turn_id AND turn.payload->>'status'='running' AND document.owner_id=p_owner_id FOR UPDATE OF turn, session;
  IF v_session_id IS NULL THEN RAISE EXCEPTION 'grant_edit_turn_not_running'; END IF;
  INSERT INTO public.grant_ai_edit_candidates(candidate_id,session_id,produced_by_turn_id,payload,created_at) VALUES ((p_candidate->>'candidateId')::UUID,v_session_id,p_turn_id,p_candidate,(p_candidate->>'createdAt')::TIMESTAMPTZ);
  UPDATE public.grant_ai_edit_turns SET payload=jsonb_set(jsonb_set(payload,'{status}','"succeeded"'),'{completedAt}',to_jsonb(p_completed_at)) WHERE turn_id=p_turn_id;
  v_state := p_candidate->>'safetyState';
  UPDATE public.grant_ai_edit_sessions SET payload=jsonb_set(jsonb_set(CASE WHEN v_state='passed' THEN jsonb_set(payload,'{lastSafeCandidateId}',to_jsonb(p_candidate->>'candidateId')) ELSE payload END,'{activeCandidateId}',to_jsonb(p_candidate->>'candidateId')),'{lastActiveAt}',to_jsonb(p_completed_at)), updated_at=p_completed_at WHERE session_id=v_session_id;
END; $$;

CREATE OR REPLACE FUNCTION public.fail_grant_ai_edit_turn(p_owner_id UUID,p_turn_id UUID,p_completed_at TIMESTAMPTZ,p_failure_category TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
  UPDATE public.grant_ai_edit_turns turn SET payload=jsonb_set(jsonb_set(jsonb_set(payload,'{status}','"failed"'),'{failureCategory}',to_jsonb(p_failure_category)),'{completedAt}',to_jsonb(p_completed_at)) FROM public.grant_ai_edit_sessions session JOIN public.grant_documents document ON document.document_id=session.document_id WHERE turn.turn_id=p_turn_id AND turn.session_id=session.session_id AND turn.payload->>'status'='running' AND document.owner_id=p_owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_edit_turn_not_running'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.list_grant_ai_edit_turns(p_owner_id UUID,p_session_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT COALESCE(jsonb_agg(turn.payload ORDER BY turn.created_at),'[]'::jsonb) FROM public.grant_ai_edit_turns turn JOIN public.grant_ai_edit_sessions session ON session.session_id=turn.session_id JOIN public.grant_documents document ON document.document_id=session.document_id WHERE turn.session_id=p_session_id AND document.owner_id=p_owner_id; $$;
CREATE OR REPLACE FUNCTION public.list_grant_ai_edit_candidates(p_owner_id UUID,p_session_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT COALESCE(jsonb_agg(candidate.payload ORDER BY candidate.created_at),'[]'::jsonb) FROM public.grant_ai_edit_candidates candidate JOIN public.grant_ai_edit_sessions session ON session.session_id=candidate.session_id JOIN public.grant_documents document ON document.document_id=session.document_id WHERE candidate.session_id=p_session_id AND document.owner_id=p_owner_id; $$;

CREATE OR REPLACE FUNCTION public.update_grant_ai_edit_session_state(p_owner_id UUID,p_session_id UUID,p_patch JSONB,p_updated_at TIMESTAMPTZ)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
  UPDATE public.grant_ai_edit_sessions session SET payload=session.payload||p_patch||jsonb_build_object('lastActiveAt',p_updated_at),updated_at=p_updated_at FROM public.grant_documents document WHERE session.session_id=p_session_id AND document.document_id=session.document_id AND document.owner_id=p_owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_edit_session_not_found'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_grant_ai_edit_candidate_needs_repair(p_owner_id UUID,p_candidate_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
  UPDATE public.grant_ai_edit_candidates candidate SET payload=jsonb_set(jsonb_set(payload,'{safetyState}','"needs_repair"'),'{factCheck,state}','"needs_repair"') FROM public.grant_ai_edit_sessions session JOIN public.grant_documents document ON document.document_id=session.document_id WHERE candidate.candidate_id=p_candidate_id AND candidate.session_id=session.session_id AND document.owner_id=p_owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_edit_candidate_not_found'; END IF;
END; $$;

REVOKE ALL ON FUNCTION public.create_grant_ai_edit_session(UUID,JSONB), public.get_grant_ai_edit_session(UUID,UUID), public.create_grant_ai_edit_turn(UUID,JSONB), public.complete_grant_ai_edit_turn(UUID,UUID,TIMESTAMPTZ,JSONB), public.fail_grant_ai_edit_turn(UUID,UUID,TIMESTAMPTZ,TEXT), public.list_grant_ai_edit_turns(UUID,UUID), public.list_grant_ai_edit_candidates(UUID,UUID), public.update_grant_ai_edit_session_state(UUID,UUID,JSONB,TIMESTAMPTZ), public.mark_grant_ai_edit_candidate_needs_repair(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_grant_ai_edit_session(UUID,JSONB), public.get_grant_ai_edit_session(UUID,UUID), public.create_grant_ai_edit_turn(UUID,JSONB), public.complete_grant_ai_edit_turn(UUID,UUID,TIMESTAMPTZ,JSONB), public.fail_grant_ai_edit_turn(UUID,UUID,TIMESTAMPTZ,TEXT), public.list_grant_ai_edit_turns(UUID,UUID), public.list_grant_ai_edit_candidates(UUID,UUID), public.update_grant_ai_edit_session_state(UUID,UUID,JSONB,TIMESTAMPTZ), public.mark_grant_ai_edit_candidate_needs_repair(UUID,UUID) TO service_role;

