-- PR6: project evidence, deterministic Evidence Cards and current authorization.
-- Additive and isolated from chat, Document V2 and the literature workspace.

CREATE TABLE IF NOT EXISTS public.grant_evidence_sources (
  source_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'deletion_pending', 'deleted')),
  source JSONB NOT NULL CHECK (jsonb_typeof(source) = 'object'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.grant_evidence_cards (
  card_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.grant_evidence_sources(source_id) ON DELETE CASCADE,
  card_order INTEGER NOT NULL CHECK (card_order >= 0),
  card JSONB NOT NULL CHECK (jsonb_typeof(card) = 'object'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (source_id, card_order)
);

CREATE TABLE IF NOT EXISTS public.grant_evidence_authorizations (
  authorization_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_id UUID NOT NULL UNIQUE REFERENCES public.grant_evidence_sources(source_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  authorization_state JSONB NOT NULL CHECK (jsonb_typeof(authorization_state) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.grant_evidence_dependencies (
  dependency_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.grant_evidence_sources(source_id) ON DELETE CASCADE,
  dependent_kind TEXT NOT NULL CHECK (dependent_kind IN ('queued_model_call', 'context_cache', 'patch_proposal')),
  dependent_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'evidence_revoked')),
  dependency JSONB NOT NULL CHECK (jsonb_typeof(dependency) = 'object'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (source_id, dependent_kind, dependent_id)
);

CREATE TABLE IF NOT EXISTS public.grant_evidence_audit_events (
  audit_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.grant_evidence_sources(source_id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('source_created', 'authorization_updated', 'source_revoked', 'deletion_started', 'deletion_completed')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS grant_evidence_sources_document_created_idx ON public.grant_evidence_sources (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS grant_evidence_cards_source_order_idx ON public.grant_evidence_cards (source_id, card_order);
CREATE INDEX IF NOT EXISTS grant_evidence_dependencies_source_status_idx ON public.grant_evidence_dependencies (source_id, status);

ALTER TABLE public.grant_evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_evidence_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_evidence_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_evidence_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_evidence_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_evidence_sources, public.grant_evidence_cards, public.grant_evidence_authorizations, public.grant_evidence_dependencies, public.grant_evidence_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_evidence_sources, public.grant_evidence_cards, public.grant_evidence_authorizations, public.grant_evidence_dependencies, public.grant_evidence_audit_events TO service_role;

ALTER TABLE public.grant_patch_proposals DROP CONSTRAINT IF EXISTS grant_patch_proposals_status_check;
ALTER TABLE public.grant_patch_proposals ADD CONSTRAINT grant_patch_proposals_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'invalidated', 'evidence_revoked'));

CREATE OR REPLACE FUNCTION public.build_grant_evidence_resource(p_source_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'source', source.source,
    'authorization', auth.authorization_state,
    'cards', COALESCE((
      SELECT jsonb_agg(card.card ORDER BY card.card_order)
      FROM public.grant_evidence_cards AS card
      WHERE card.source_id = source.source_id
    ), '[]'::JSONB)
  )
  FROM public.grant_evidence_sources AS source
  JOIN public.grant_evidence_authorizations AS auth ON auth.source_id = source.source_id
  WHERE source.source_id = p_source_id;
$$;

CREATE OR REPLACE FUNCTION public.create_grant_evidence_resource(p_owner_id UUID, p_resource JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source JSONB := p_resource->'source';
  v_authorization JSONB := p_resource->'authorization';
  v_source_id UUID := (v_source->>'sourceId')::UUID;
  v_document_id UUID := (v_source->>'documentId')::UUID;
  v_actor_id UUID := (v_source->>'createdBy')::UUID;
  v_card JSONB;
BEGIN
  IF v_actor_id IS DISTINCT FROM p_owner_id OR NOT EXISTS (
    SELECT 1 FROM public.grant_documents WHERE document_id = v_document_id AND owner_id = p_owner_id
  ) THEN RAISE EXCEPTION 'grant document not found'; END IF;
  IF v_authorization->>'sourceId' <> v_source_id::TEXT OR v_authorization->>'documentId' <> v_document_id::TEXT THEN
    RAISE EXCEPTION 'evidence authorization identity mismatch';
  END IF;

  INSERT INTO public.grant_evidence_sources(source_id, document_id, status, source, created_at, updated_at)
  VALUES (v_source_id, v_document_id, 'active', v_source, (v_source->>'createdAt')::TIMESTAMPTZ, (v_source->>'updatedAt')::TIMESTAMPTZ);
  INSERT INTO public.grant_evidence_authorizations(authorization_id, document_id, source_id, revision, authorization_state, updated_at)
  VALUES ((v_authorization->>'authorizationId')::UUID, v_document_id, v_source_id, 1, v_authorization, (v_authorization->>'updatedAt')::TIMESTAMPTZ);
  FOR v_card IN SELECT value FROM jsonb_array_elements(p_resource->'cards') LOOP
    IF v_card->>'sourceId' <> v_source_id::TEXT OR v_card->>'documentId' <> v_document_id::TEXT THEN
      RAISE EXCEPTION 'evidence card identity mismatch';
    END IF;
    INSERT INTO public.grant_evidence_cards(card_id, document_id, source_id, card_order, card, created_at)
    VALUES ((v_card->>'cardId')::UUID, v_document_id, v_source_id, (v_card->>'order')::INTEGER, v_card, (v_card->>'createdAt')::TIMESTAMPTZ);
  END LOOP;
  INSERT INTO public.grant_evidence_audit_events(document_id, source_id, actor_id, event_type, metadata, created_at)
  VALUES (v_document_id, v_source_id, v_actor_id, 'source_created', jsonb_build_object('contentHash', v_source->>'contentHash'), (v_source->>'createdAt')::TIMESTAMPTZ);
  RETURN public.build_grant_evidence_resource(v_source_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_evidence_resources(p_owner_id UUID, p_document_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(public.build_grant_evidence_resource(source.source_id) ORDER BY source.created_at DESC), '[]'::JSONB)
  FROM public.grant_evidence_sources AS source
  JOIN public.grant_documents AS document ON document.document_id = source.document_id
  WHERE source.document_id = p_document_id AND source.status <> 'deleted' AND document.owner_id = p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.get_grant_evidence_resource(p_owner_id UUID, p_document_id UUID, p_source_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.build_grant_evidence_resource(source.source_id)
  FROM public.grant_evidence_sources AS source
  JOIN public.grant_documents AS document ON document.document_id = source.document_id
  WHERE source.source_id = p_source_id AND source.document_id = p_document_id AND document.owner_id = p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.update_grant_evidence_authorization(
  p_owner_id UUID, p_document_id UUID, p_source_id UUID, p_expected_revision INTEGER,
  p_permissions JSONB, p_allowed_task_ids JSONB, p_expires_at TIMESTAMPTZ,
  p_actor_id UUID, p_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result JSONB;
BEGIN
  IF p_actor_id IS DISTINCT FROM p_owner_id OR NOT EXISTS (
    SELECT 1 FROM public.grant_documents WHERE document_id = p_document_id AND owner_id = p_owner_id
  ) THEN RAISE EXCEPTION 'grant document not found'; END IF;
  UPDATE public.grant_evidence_authorizations AS auth
  SET revision = revision + 1,
      updated_at = p_updated_at,
      authorization_state = jsonb_strip_nulls(
        (auth.authorization_state - 'allowedTaskIds' - 'expiresAt' - 'revokedAt')
        || jsonb_build_object(
          'revision', revision + 1, 'permissions', p_permissions,
          'allowedTaskIds', p_allowed_task_ids, 'expiresAt', p_expires_at,
          'updatedBy', p_actor_id, 'updatedAt', p_updated_at
        )
      )
  FROM public.grant_evidence_sources AS source
  WHERE auth.source_id = p_source_id AND auth.document_id = p_document_id
    AND auth.revision = p_expected_revision
    AND source.source_id = auth.source_id AND source.status = 'active'
  RETURNING auth.authorization_state INTO v_result;
  IF v_result IS NULL THEN RAISE EXCEPTION 'evidence authorization revision conflict'; END IF;
  INSERT INTO public.grant_evidence_audit_events(document_id, source_id, actor_id, event_type, metadata, created_at)
  VALUES (p_document_id, p_source_id, p_actor_id, 'authorization_updated', jsonb_build_object('expectedRevision', p_expected_revision), p_updated_at);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_grant_evidence_source(
  p_owner_id UUID, p_document_id UUID, p_source_id UUID, p_expected_revision INTEGER,
  p_actor_id UUID, p_revoked_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_authorization JSONB; v_denied JSONB := '{"read":false,"index":false,"sendRelevantExcerptToModel":false,"useForReasoning":false,"useForCitation":false}'::JSONB;
BEGIN
  IF p_actor_id IS DISTINCT FROM p_owner_id OR NOT EXISTS (
    SELECT 1 FROM public.grant_documents WHERE document_id = p_document_id AND owner_id = p_owner_id
  ) THEN RAISE EXCEPTION 'grant document not found'; END IF;
  UPDATE public.grant_evidence_authorizations
  SET revision = revision + 1, updated_at = p_revoked_at,
      authorization_state = authorization_state || jsonb_build_object(
        'revision', revision + 1, 'permissions', v_denied, 'revokedAt', p_revoked_at,
        'updatedBy', p_actor_id, 'updatedAt', p_revoked_at
      )
  WHERE source_id = p_source_id AND document_id = p_document_id AND revision = p_expected_revision
  RETURNING authorization_state INTO v_authorization;
  IF v_authorization IS NULL THEN RAISE EXCEPTION 'evidence authorization revision conflict'; END IF;
  UPDATE public.grant_evidence_sources SET status = 'revoked', updated_at = p_revoked_at,
    source = source || jsonb_build_object('status', 'revoked', 'revokedAt', p_revoked_at, 'updatedAt', p_revoked_at)
  WHERE source_id = p_source_id AND document_id = p_document_id AND status = 'active';
  UPDATE public.grant_evidence_cards SET card = card || jsonb_build_object('status', 'revoked') WHERE source_id = p_source_id;
  UPDATE public.grant_patch_proposals AS proposal SET status = 'evidence_revoked', updated_at = p_revoked_at,
    proposal = proposal.proposal || jsonb_build_object('status', 'evidence_revoked', 'updatedAt', p_revoked_at)
  WHERE proposal.status = 'pending' AND EXISTS (
    SELECT 1 FROM public.grant_evidence_dependencies AS dependency
    WHERE dependency.source_id = p_source_id AND dependency.dependent_kind = 'patch_proposal'
      AND dependency.dependent_id = proposal.proposal_id AND dependency.status = 'active'
  );
  UPDATE public.grant_evidence_dependencies SET status = 'evidence_revoked', updated_at = p_revoked_at,
    dependency = dependency || jsonb_build_object('status', 'evidence_revoked', 'updatedAt', p_revoked_at)
  WHERE source_id = p_source_id AND status = 'active';
  INSERT INTO public.grant_evidence_audit_events(document_id, source_id, actor_id, event_type, metadata, created_at)
  VALUES (p_document_id, p_source_id, p_actor_id, 'source_revoked', jsonb_build_object('authorizationRevision', p_expected_revision + 1), p_revoked_at);
  RETURN public.build_grant_evidence_resource(p_source_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_grant_evidence_deletion(
  p_owner_id UUID, p_document_id UUID, p_source_id UUID, p_actor_id UUID, p_deleted_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_denied JSONB := '{"read":false,"index":false,"sendRelevantExcerptToModel":false,"useForReasoning":false,"useForCitation":false}'::JSONB;
BEGIN
  IF p_actor_id IS DISTINCT FROM p_owner_id OR NOT EXISTS (
    SELECT 1 FROM public.grant_documents WHERE document_id = p_document_id AND owner_id = p_owner_id
  ) THEN RAISE EXCEPTION 'grant document not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.grant_evidence_sources WHERE source_id = p_source_id AND document_id = p_document_id) THEN
    RAISE EXCEPTION 'evidence source not found';
  END IF;
  UPDATE public.grant_evidence_sources SET status = 'deletion_pending', updated_at = p_deleted_at,
    source = source || jsonb_build_object('status', 'deletion_pending', 'revokedAt', COALESCE(source->'revokedAt', to_jsonb(p_deleted_at)), 'updatedAt', p_deleted_at)
  WHERE source_id = p_source_id AND status NOT IN ('deletion_pending', 'deleted');
  UPDATE public.grant_evidence_authorizations SET revision = revision + 1, updated_at = p_deleted_at,
    authorization_state = authorization_state || jsonb_build_object(
      'revision', revision + 1, 'permissions', v_denied,
      'revokedAt', COALESCE(authorization_state->'revokedAt', to_jsonb(p_deleted_at)),
      'updatedBy', p_actor_id, 'updatedAt', p_deleted_at
    )
  WHERE source_id = p_source_id AND NOT (authorization_state ? 'revokedAt');
  DELETE FROM public.grant_evidence_cards WHERE source_id = p_source_id;
  UPDATE public.grant_patch_proposals AS proposal SET status = 'evidence_revoked', updated_at = p_deleted_at,
    proposal = proposal.proposal || jsonb_build_object('status', 'evidence_revoked', 'updatedAt', p_deleted_at)
  WHERE proposal.status = 'pending' AND EXISTS (
    SELECT 1 FROM public.grant_evidence_dependencies AS dependency
    WHERE dependency.source_id = p_source_id AND dependency.dependent_kind = 'patch_proposal'
      AND dependency.dependent_id = proposal.proposal_id AND dependency.status = 'active'
  );
  UPDATE public.grant_evidence_dependencies SET status = 'evidence_revoked', updated_at = p_deleted_at,
    dependency = dependency || jsonb_build_object('status', 'evidence_revoked', 'updatedAt', p_deleted_at)
  WHERE source_id = p_source_id AND status = 'active';
  INSERT INTO public.grant_evidence_audit_events(document_id, source_id, actor_id, event_type, created_at)
  SELECT p_document_id, p_source_id, p_actor_id, 'deletion_started', p_deleted_at
  WHERE NOT EXISTS (
    SELECT 1 FROM public.grant_evidence_audit_events WHERE source_id = p_source_id AND event_type = 'deletion_started'
  );
  RETURN public.build_grant_evidence_resource(p_source_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_grant_evidence_deletion(
  p_owner_id UUID, p_document_id UUID, p_source_id UUID, p_actor_id UUID, p_deleted_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_actor_id IS DISTINCT FROM p_owner_id OR NOT EXISTS (
    SELECT 1 FROM public.grant_documents WHERE document_id = p_document_id AND owner_id = p_owner_id
  ) THEN RAISE EXCEPTION 'grant document not found'; END IF;
  UPDATE public.grant_evidence_sources SET status = 'deleted', updated_at = p_deleted_at,
    source = (source - 'storage') || jsonb_build_object('status', 'deleted', 'deletedAt', p_deleted_at, 'updatedAt', p_deleted_at)
  WHERE source_id = p_source_id AND document_id = p_document_id AND status IN ('deletion_pending', 'deleted');
  IF NOT FOUND THEN RAISE EXCEPTION 'evidence deletion has not begun'; END IF;
  INSERT INTO public.grant_evidence_audit_events(document_id, source_id, actor_id, event_type, created_at)
  SELECT p_document_id, p_source_id, p_actor_id, 'deletion_completed', p_deleted_at
  WHERE NOT EXISTS (
    SELECT 1 FROM public.grant_evidence_audit_events WHERE source_id = p_source_id AND event_type = 'deletion_completed'
  );
  RETURN public.build_grant_evidence_resource(p_source_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_grant_evidence_dependency(p_owner_id UUID, p_dependency JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_document_id UUID := (p_dependency->>'documentId')::UUID; v_source_id UUID := (p_dependency->>'sourceId')::UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grant_documents WHERE document_id = v_document_id AND owner_id = p_owner_id) THEN RAISE EXCEPTION 'grant document not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.grant_evidence_sources WHERE source_id = v_source_id AND document_id = v_document_id AND status = 'active') THEN RAISE EXCEPTION 'evidence source is not active'; END IF;
  INSERT INTO public.grant_evidence_dependencies(dependency_id, document_id, source_id, dependent_kind, dependent_id, status, dependency, created_at, updated_at)
  VALUES ((p_dependency->>'dependencyId')::UUID, v_document_id, v_source_id, p_dependency->>'dependentKind', (p_dependency->>'dependentId')::UUID, 'active', p_dependency, (p_dependency->>'createdAt')::TIMESTAMPTZ, (p_dependency->>'updatedAt')::TIMESTAMPTZ);
  RETURN p_dependency;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_evidence_dependencies(p_owner_id UUID, p_document_id UUID, p_source_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(dependency.dependency ORDER BY dependency.created_at), '[]'::JSONB)
  FROM public.grant_evidence_dependencies AS dependency
  JOIN public.grant_documents AS document ON document.document_id = dependency.document_id
  WHERE dependency.document_id = p_document_id AND dependency.source_id = p_source_id AND document.owner_id = p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.build_grant_evidence_resource(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_grant_evidence_resource(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_evidence_resources(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_grant_evidence_resource(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_grant_evidence_authorization(UUID, UUID, UUID, INTEGER, JSONB, JSONB, TIMESTAMPTZ, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_grant_evidence_source(UUID, UUID, UUID, INTEGER, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_grant_evidence_deletion(UUID, UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_grant_evidence_deletion(UUID, UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_grant_evidence_dependency(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_evidence_dependencies(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_grant_evidence_resource(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_evidence_resources(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_grant_evidence_resource(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_grant_evidence_authorization(UUID, UUID, UUID, INTEGER, JSONB, JSONB, TIMESTAMPTZ, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_grant_evidence_source(UUID, UUID, UUID, INTEGER, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_grant_evidence_deletion(UUID, UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_grant_evidence_deletion(UUID, UUID, UUID, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_grant_evidence_dependency(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_evidence_dependencies(UUID, UUID, UUID) TO service_role;

COMMENT ON TABLE public.grant_evidence_authorizations IS 'Current Evidence Authorization Service state; cached authorization is never authoritative.';
COMMENT ON TABLE public.grant_evidence_dependencies IS 'Source identities for revocation propagation; never stores send-ready evidence excerpts.';
