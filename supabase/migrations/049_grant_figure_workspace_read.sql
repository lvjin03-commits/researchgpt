-- Step 3: owner-scoped metadata read for rendering imported figures in the
-- existing grant workspace. Storage remains private and model use stays denied.

CREATE OR REPLACE FUNCTION public.list_grant_imported_figure_assets(
  p_owner_id UUID,
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assetId', asset.asset_id,
    'documentId', asset.document_id,
    'sourceRevisionId', asset.source_revision_id,
    'sourceDocumentChecksum', asset.source_document_checksum,
    'contentHash', asset.content_hash,
    'mediaType', asset.media_type,
    'byteSize', asset.byte_size,
    'widthPx', asset.width_px,
    'heightPx', asset.height_px,
    'storage', jsonb_build_object(
      'bucket', asset.storage_bucket,
      'path', asset.storage_path
    ),
    'anchor', asset.anchor,
    'createdAt', asset.created_at
  ) ORDER BY (asset.anchor->>'sourceOrdinal')::INTEGER, asset.asset_id), '[]'::JSONB)
  FROM public.grant_imported_figure_assets AS asset
  JOIN public.grant_documents AS document
    ON document.document_id = asset.document_id
  WHERE asset.document_id = p_document_id
    AND document.owner_id = p_owner_id
    AND document.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.list_grant_imported_figure_assets(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_grant_imported_figure_assets(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.list_grant_imported_figure_assets(UUID, UUID) IS
  'Owner-scoped immutable figure metadata for workspace presentation; does not grant model access.';
