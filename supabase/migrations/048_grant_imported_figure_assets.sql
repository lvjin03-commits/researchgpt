-- Step 2: immutable DOCX figure assets are created in the same transaction as
-- the canonical grant document foundation. This does not authorize model use.

CREATE TABLE IF NOT EXISTS public.grant_imported_figure_assets (
  asset_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id) ON DELETE CASCADE,
  source_document_checksum TEXT NOT NULL CHECK (source_document_checksum ~ '^[a-f0-9]{64}$'),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  media_type TEXT NOT NULL CHECK (media_type IN (
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'image/tiff', 'image/bmp', 'image/x-emf', 'image/x-wmf'
  )),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 52428800),
  width_px INTEGER CHECK (width_px IS NULL OR width_px > 0),
  height_px INTEGER CHECK (height_px IS NULL OR height_px > 0),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  anchor JSONB NOT NULL CHECK (jsonb_typeof(anchor) = 'object'),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS grant_imported_figure_assets_source_order_idx
  ON public.grant_imported_figure_assets (
    document_id,
    source_revision_id,
    ((anchor->>'sourceOrdinal')::INTEGER)
  );

ALTER TABLE public.grant_imported_figure_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_imported_figure_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_imported_figure_assets TO service_role;

DROP TRIGGER IF EXISTS grant_imported_figure_assets_immutable ON public.grant_imported_figure_assets;
CREATE TRIGGER grant_imported_figure_assets_immutable
BEFORE UPDATE ON public.grant_imported_figure_assets
FOR EACH ROW EXECUTE FUNCTION public.reject_grant_immutable_change();

DROP FUNCTION IF EXISTS public.create_grant_document_foundation(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT, JSONB, UUID, UUID, JSONB
);

CREATE OR REPLACE FUNCTION public.create_grant_document_foundation(
  p_owner_id UUID,
  p_document_id UUID,
  p_title TEXT,
  p_template_snapshot_id UUID,
  p_template_key TEXT,
  p_template_version TEXT,
  p_template_rules JSONB,
  p_template_checksum TEXT,
  p_revision_id UUID,
  p_content_hash TEXT,
  p_snapshot JSONB,
  p_actor_id UUID,
  p_audit_event_id UUID,
  p_audit_metadata JSONB DEFAULT '{}'::JSONB,
  p_figure_assets JSONB DEFAULT '[]'::JSONB
)
RETURNS public.grant_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_document public.grant_documents;
  v_created_at TIMESTAMPTZ := clock_timestamp();
  v_asset JSONB;
  v_asset_id UUID;
  v_figure_node_count INTEGER;
BEGIN
  IF p_owner_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'initial document actor must be the owner';
  END IF;
  IF jsonb_typeof(p_figure_assets) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'figure assets must be a JSON array';
  END IF;

  SELECT count(*) INTO v_figure_node_count
  FROM jsonb_array_elements(COALESCE(p_snapshot->'nodes', '[]'::JSONB)) AS node
  WHERE node->>'nodeType' = 'figure';
  IF v_figure_node_count IS DISTINCT FROM jsonb_array_length(p_figure_assets) THEN
    RAISE EXCEPTION 'canonical figure nodes and imported figure assets differ';
  END IF;

  INSERT INTO public.grant_template_snapshots (
    template_snapshot_id, owner_id, template_key, template_version, rules, checksum, created_at
  ) VALUES (
    p_template_snapshot_id, p_owner_id, p_template_key, p_template_version,
    p_template_rules, p_template_checksum, v_created_at
  );

  INSERT INTO public.grant_documents (
    document_id, owner_id, title, template_snapshot_id,
    current_revision_number, created_at, updated_at
  ) VALUES (
    p_document_id, p_owner_id, p_title, p_template_snapshot_id, 0, v_created_at, v_created_at
  );

  INSERT INTO public.grant_document_revisions (
    revision_id, document_id, revision_number, template_snapshot_id,
    content_hash, snapshot, created_by, created_at
  ) VALUES (
    p_revision_id, p_document_id, 1, p_template_snapshot_id,
    p_content_hash, p_snapshot, p_actor_id, v_created_at
  );

  FOR v_asset IN SELECT value FROM jsonb_array_elements(p_figure_assets) LOOP
    v_asset_id := (v_asset->>'assetId')::UUID;
    IF v_asset->>'documentId' IS DISTINCT FROM p_document_id::TEXT
      OR v_asset->>'sourceRevisionId' IS DISTINCT FROM p_revision_id::TEXT
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_snapshot->'nodes') AS node
        WHERE node->>'nodeType' = 'figure'
          AND node->'content'->>'assetId' = v_asset_id::TEXT
      ) THEN
      RAISE EXCEPTION 'figure asset identity does not match the canonical foundation';
    END IF;
    INSERT INTO public.grant_imported_figure_assets (
      asset_id, document_id, source_revision_id,
      source_document_checksum, content_hash, media_type, byte_size,
      width_px, height_px, storage_bucket, storage_path, anchor, created_at
    ) VALUES (
      v_asset_id, p_document_id, p_revision_id,
      v_asset->>'sourceDocumentChecksum', v_asset->>'contentHash', v_asset->>'mediaType',
      (v_asset->>'byteSize')::INTEGER, (v_asset->>'widthPx')::INTEGER,
      (v_asset->>'heightPx')::INTEGER, v_asset->'storage'->>'bucket',
      v_asset->'storage'->>'path', v_asset->'anchor', v_created_at
    );
  END LOOP;

  UPDATE public.grant_documents
  SET current_revision_id = p_revision_id,
      current_revision_number = 1,
      updated_at = v_created_at
  WHERE document_id = p_document_id
  RETURNING * INTO created_document;

  INSERT INTO public.grant_audit_events (
    audit_event_id, document_id, revision_id, actor_id, actor_kind,
    event_type, metadata, created_at
  ) VALUES (
    p_audit_event_id, p_document_id, p_revision_id, p_actor_id, 'user',
    'document_created', p_audit_metadata || jsonb_build_object(
      'importedFigureCount', jsonb_array_length(p_figure_assets)
    ), v_created_at
  );

  RETURN created_document;
END;
$$;

REVOKE ALL ON FUNCTION public.create_grant_document_foundation(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT, JSONB, UUID, UUID, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_grant_document_foundation(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT, JSONB, UUID, UUID, JSONB, JSONB
) TO service_role;

COMMENT ON TABLE public.grant_imported_figure_assets IS
  'Immutable image provenance from DOCX import; storage does not authorize model access.';
