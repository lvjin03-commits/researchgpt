-- Persistent Grant assistant projection. It owns chat history and links only;
-- Edit Sessions retain candidates and Revision Service retains canonical writes.

CREATE TABLE public.grant_assistant_sessions (
  session_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active','stale','expired')),
  created_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX grant_assistant_current_session_idx ON public.grant_assistant_sessions(document_id) WHERE status IN ('active','stale');

CREATE TABLE public.grant_assistant_messages (
  message_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.grant_assistant_sessions(session_id) ON DELETE CASCADE,
  turn_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(session_id, turn_id, role)
);
CREATE INDEX grant_assistant_messages_session_idx ON public.grant_assistant_messages(session_id, created_at);

CREATE TABLE public.grant_assistant_edit_session_links (
  assistant_session_id UUID NOT NULL REFERENCES public.grant_assistant_sessions(session_id) ON DELETE CASCADE,
  edit_session_id UUID NOT NULL REFERENCES public.grant_ai_edit_sessions(session_id) ON DELETE CASCADE,
  linked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (assistant_session_id, edit_session_id)
);

ALTER TABLE public.grant_assistant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_assistant_edit_session_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grant_assistant_sessions, public.grant_assistant_messages, public.grant_assistant_edit_session_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grant_assistant_sessions, public.grant_assistant_messages, public.grant_assistant_edit_session_links TO service_role;

CREATE OR REPLACE FUNCTION public.grant_assistant_session_json(value public.grant_assistant_sessions) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=public AS $$
  SELECT jsonb_build_object('sessionId',value.session_id,'documentId',value.document_id,'status',value.status,'createdAt',value.created_at,'lastActiveAt',value.last_active_at);
$$;

CREATE OR REPLACE FUNCTION public.ensure_grant_assistant_session(p_owner_id UUID,p_document_id UUID,p_session_id UUID,p_now TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE stored public.grant_assistant_sessions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grant_documents WHERE document_id=p_document_id AND owner_id=p_owner_id) THEN RAISE EXCEPTION 'grant_document_not_found'; END IF;
  SELECT session.* INTO stored FROM public.grant_assistant_sessions session WHERE session.document_id=p_document_id AND session.status IN ('active','stale') ORDER BY session.created_at DESC LIMIT 1 FOR UPDATE;
  IF stored.session_id IS NOT NULL AND stored.last_active_at < p_now - INTERVAL '90 days' THEN
    UPDATE public.grant_assistant_sessions SET status='expired' WHERE session_id=stored.session_id;
    stored.session_id := NULL;
  END IF;
  IF stored.session_id IS NULL THEN
    INSERT INTO public.grant_assistant_sessions(session_id,document_id,status,created_at,last_active_at) VALUES(p_session_id,p_document_id,'active',p_now,p_now) RETURNING * INTO stored;
  ELSE
    UPDATE public.grant_assistant_sessions SET status='active',last_active_at=p_now WHERE session_id=stored.session_id RETURNING * INTO stored;
  END IF;
  RETURN public.grant_assistant_session_json(stored);
END; $$;

CREATE OR REPLACE FUNCTION public.get_current_grant_assistant_session(p_owner_id UUID,p_document_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.grant_assistant_session_json(session) FROM public.grant_assistant_sessions session JOIN public.grant_documents document ON document.document_id=session.document_id WHERE session.document_id=p_document_id AND session.status IN ('active','stale') AND document.owner_id=p_owner_id ORDER BY session.created_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_assistant_messages(p_owner_id UUID,p_session_id UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(message.payload ORDER BY message.created_at),'[]'::jsonb) FROM public.grant_assistant_messages message JOIN public.grant_assistant_sessions session ON session.session_id=message.session_id JOIN public.grant_documents document ON document.document_id=session.document_id WHERE message.session_id=p_session_id AND document.owner_id=p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.append_grant_assistant_turn(p_owner_id UUID,p_session_id UUID,p_user_message JSONB,p_assistant_message JSONB,p_last_active_at TIMESTAMPTZ) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grant_assistant_sessions session JOIN public.grant_documents document ON document.document_id=session.document_id WHERE session.session_id=p_session_id AND session.status='active' AND document.owner_id=p_owner_id) THEN RAISE EXCEPTION 'grant_assistant_session_not_active'; END IF;
  INSERT INTO public.grant_assistant_messages(message_id,session_id,turn_id,role,payload,created_at) VALUES
    ((p_user_message->>'messageId')::uuid,p_session_id,(p_user_message->>'turnId')::uuid,'user',p_user_message,(p_user_message->>'createdAt')::timestamptz),
    ((p_assistant_message->>'messageId')::uuid,p_session_id,(p_assistant_message->>'turnId')::uuid,'assistant',p_assistant_message,(p_assistant_message->>'createdAt')::timestamptz);
  UPDATE public.grant_assistant_sessions SET last_active_at=p_last_active_at WHERE session_id=p_session_id;
END; $$;

CREATE OR REPLACE FUNCTION public.link_grant_assistant_edit_session(p_owner_id UUID,p_assistant_session_id UUID,p_edit_session_id UUID,p_linked_at TIMESTAMPTZ) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grant_assistant_sessions assistant JOIN public.grant_ai_edit_sessions edit ON edit.document_id=assistant.document_id JOIN public.grant_documents document ON document.document_id=assistant.document_id WHERE assistant.session_id=p_assistant_session_id AND edit.session_id=p_edit_session_id AND document.owner_id=p_owner_id) THEN RAISE EXCEPTION 'grant_assistant_edit_session_mismatch'; END IF;
  INSERT INTO public.grant_assistant_edit_session_links(assistant_session_id,edit_session_id,linked_at) VALUES(p_assistant_session_id,p_edit_session_id,p_linked_at) ON CONFLICT DO NOTHING;
END; $$;

CREATE OR REPLACE FUNCTION public.maintain_grant_assistant_sessions(p_now TIMESTAMPTZ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE stale_count INTEGER; expired_count INTEGER; deleted_message_count INTEGER;
BEGIN
  UPDATE public.grant_assistant_sessions SET status='stale' WHERE status='active' AND last_active_at < p_now - INTERVAL '7 days';
  GET DIAGNOSTICS stale_count = ROW_COUNT;
  UPDATE public.grant_assistant_sessions SET status='expired' WHERE status IN ('active','stale') AND last_active_at < p_now - INTERVAL '90 days';
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  DELETE FROM public.grant_assistant_messages message WHERE message.session_id IN (
    SELECT session.session_id FROM public.grant_assistant_sessions session
    WHERE session.status='expired' AND NOT EXISTS (SELECT 1 FROM public.grant_assistant_edit_session_links link WHERE link.assistant_session_id=session.session_id)
  ) AND message.turn_id IN (
    SELECT assistant.turn_id FROM public.grant_assistant_messages assistant
    WHERE assistant.role='assistant' AND COALESCE(assistant.payload->>'grounding','general_reasoning')='general_reasoning' AND assistant.created_at < p_now - INTERVAL '90 days'
  );
  GET DIAGNOSTICS deleted_message_count = ROW_COUNT;
  RETURN jsonb_build_object('staleSessions',stale_count,'expiredSessions',expired_count,'deletedMessages',deleted_message_count);
END; $$;

REVOKE ALL ON FUNCTION public.grant_assistant_session_json(public.grant_assistant_sessions), public.ensure_grant_assistant_session(UUID,UUID,UUID,TIMESTAMPTZ), public.get_current_grant_assistant_session(UUID,UUID), public.list_grant_assistant_messages(UUID,UUID), public.append_grant_assistant_turn(UUID,UUID,JSONB,JSONB,TIMESTAMPTZ), public.link_grant_assistant_edit_session(UUID,UUID,UUID,TIMESTAMPTZ), public.maintain_grant_assistant_sessions(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_assistant_session_json(public.grant_assistant_sessions), public.ensure_grant_assistant_session(UUID,UUID,UUID,TIMESTAMPTZ), public.get_current_grant_assistant_session(UUID,UUID), public.list_grant_assistant_messages(UUID,UUID), public.append_grant_assistant_turn(UUID,UUID,JSONB,JSONB,TIMESTAMPTZ), public.link_grant_assistant_edit_session(UUID,UUID,UUID,TIMESTAMPTZ), public.maintain_grant_assistant_sessions(TIMESTAMPTZ) TO service_role;
