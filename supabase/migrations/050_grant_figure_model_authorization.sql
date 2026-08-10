-- Step 4: explicit, revision-bound consent for sending imported figures to a
-- model. Workspace display remains independent and authorization defaults off.

CREATE TABLE IF NOT EXISTS public.grant_figure_model_authorizations (
  authorization_id UUID PRIMARY KEY,
  document_id UUID NOT NULL UNIQUE REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id) ON DELETE CASCADE,
  authorization_revision INTEGER NOT NULL CHECK (authorization_revision > 0),
  authorization_state JSONB NOT NULL CHECK (jsonb_typeof(authorization_state) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.grant_figure_model_authorization_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  authorization_id UUID NOT NULL REFERENCES public.grant_figure_model_authorizations(authorization_id) ON DELETE CASCADE,
  authorization_revision INTEGER NOT NULL CHECK (authorization_revision > 0),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('authorized', 'updated', 'revoked')),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS grant_figure_model_authorization_events_document_idx
  ON public.grant_figure_model_authorization_events (document_id, created_at DESC);

ALTER TABLE public.grant_figure_model_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_figure_model_authorization_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_figure_model_authorizations,
  public.grant_figure_model_authorization_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_figure_model_authorizations,
  public.grant_figure_model_authorization_events TO service_role;

CREATE OR REPLACE FUNCTION public.get_grant_figure_model_authorization(
  p_owner_id UUID,
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT authz.authorization_state
  FROM public.grant_figure_model_authorizations AS authz
  JOIN public.grant_documents AS document ON document.document_id = authz.document_id
  WHERE authz.document_id = p_document_id
    AND document.owner_id = p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.save_grant_figure_model_authorization(
  p_owner_id UUID,
  p_document_id UUID,
  p_expected_authorization_revision INTEGER,
  p_authorization JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_revision_id UUID;
  v_existing_revision INTEGER;
  v_authorization_id UUID := (p_authorization->>'authorizationId')::UUID;
  v_source_revision_id UUID := (p_authorization->>'sourceRevisionId')::UUID;
  v_actor_id UUID := (p_authorization->>'updatedBy')::UUID;
  v_next_revision INTEGER := (p_authorization->>'authorizationRevision')::INTEGER;
  v_allowed_asset_ids JSONB := p_authorization->'allowedAssetIds';
  v_send BOOLEAN := COALESCE((p_authorization->'permissions'->>'sendImageToModel')::BOOLEAN, FALSE);
  v_diagnose BOOLEAN := COALESCE((p_authorization->'permissions'->>'useForSemanticDiagnosis')::BOOLEAN, FALSE);
  v_event_type TEXT;
BEGIN
  SELECT document.current_revision_id INTO v_current_revision_id
  FROM public.grant_documents AS document
  WHERE document.document_id = p_document_id AND document.owner_id = p_owner_id;
  IF v_current_revision_id IS NULL OR v_actor_id IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'grant document not found';
  END IF;
  IF p_authorization->>'documentId' IS DISTINCT FROM p_document_id::TEXT
    OR v_source_revision_id IS DISTINCT FROM v_current_revision_id
    OR v_next_revision IS DISTINCT FROM p_expected_authorization_revision + 1 THEN
    RAISE EXCEPTION 'figure authorization identity mismatch';
  END IF;
  IF jsonb_typeof(v_allowed_asset_ids) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_allowed_asset_ids) = 0
    OR v_diagnose AND NOT v_send THEN
    RAISE EXCEPTION 'figure authorization permission contract invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_allowed_asset_ids) AS requested(asset_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.grant_imported_figure_assets AS asset
      WHERE asset.document_id = p_document_id AND asset.asset_id = requested.asset_id::UUID
    )
  ) THEN RAISE EXCEPTION 'figure authorization contains unknown asset'; END IF;
  IF v_send AND EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_allowed_asset_ids) AS requested(asset_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.grant_document_revisions AS revision,
        jsonb_array_elements(COALESCE(revision.snapshot->'nodes', '[]'::JSONB)) AS node
      WHERE revision.revision_id = v_current_revision_id
        AND revision.document_id = p_document_id
        AND node->>'nodeType' = 'figure'
        AND node->'content'->>'assetId' = requested.asset_id
    )
  ) THEN RAISE EXCEPTION 'figure authorization asset is outside current revision'; END IF;

  SELECT authorization_revision INTO v_existing_revision
  FROM public.grant_figure_model_authorizations
  WHERE document_id = p_document_id
  FOR UPDATE;

  IF v_existing_revision IS NULL THEN
    IF p_expected_authorization_revision <> 0 THEN
      RAISE EXCEPTION 'figure authorization revision conflict';
    END IF;
    INSERT INTO public.grant_figure_model_authorizations(
      authorization_id, document_id, source_revision_id,
      authorization_revision, authorization_state, updated_at
    ) VALUES (
      v_authorization_id, p_document_id, v_source_revision_id,
      v_next_revision, p_authorization, (p_authorization->>'updatedAt')::TIMESTAMPTZ
    );
    v_event_type := 'authorized';
  ELSE
    IF v_existing_revision IS DISTINCT FROM p_expected_authorization_revision THEN
      RAISE EXCEPTION 'figure authorization revision conflict';
    END IF;
    UPDATE public.grant_figure_model_authorizations
    SET source_revision_id = v_source_revision_id,
        authorization_revision = v_next_revision,
        authorization_state = p_authorization,
        updated_at = (p_authorization->>'updatedAt')::TIMESTAMPTZ
    WHERE document_id = p_document_id;
    v_event_type := CASE WHEN p_authorization ? 'revokedAt' AND p_authorization->>'revokedAt' IS NOT NULL
      THEN 'revoked' ELSE 'updated' END;
  END IF;

  INSERT INTO public.grant_figure_model_authorization_events(
    document_id, authorization_id, authorization_revision, actor_id,
    event_type, metadata, created_at
  ) VALUES (
    p_document_id, v_authorization_id, v_next_revision, v_actor_id,
    v_event_type, jsonb_build_object('allowedAssetCount', jsonb_array_length(v_allowed_asset_ids)),
    (p_authorization->>'updatedAt')::TIMESTAMPTZ
  );
  RETURN p_authorization;
END;
$$;

REVOKE ALL ON FUNCTION public.get_grant_figure_model_authorization(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_grant_figure_model_authorization(UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_grant_figure_model_authorization(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_grant_figure_model_authorization(UUID, UUID, INTEGER, JSONB) TO service_role;

COMMENT ON TABLE public.grant_figure_model_authorizations IS
  'Current revision-bound user consent for model use of imported grant figures; defaults to no row and no access.';
