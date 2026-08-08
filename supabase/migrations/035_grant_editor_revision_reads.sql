-- Read projections required by the PR2 structured editor. Canonical writes
-- continue to use the existing create/CAS RPCs from migrations 032-034.

CREATE OR REPLACE FUNCTION public.list_grant_documents(p_owner_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'documentId', document.document_id,
    'ownerId', document.owner_id,
    'title', document.title,
    'templateSnapshotId', document.template_snapshot_id,
    'currentRevisionId', document.current_revision_id,
    'currentRevisionNumber', document.current_revision_number,
    'createdAt', document.created_at,
    'updatedAt', document.updated_at
  ) ORDER BY document.updated_at DESC), '[]'::jsonb)
  FROM public.grant_documents AS document
  WHERE document.owner_id = p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.get_grant_document_revision(
  p_owner_id UUID,
  p_document_id UUID,
  p_revision_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'revisionId', revision.revision_id,
    'documentId', revision.document_id,
    'revisionNumber', revision.revision_number,
    'parentRevisionId', revision.parent_revision_id,
    'templateSnapshotId', revision.template_snapshot_id,
    'contentHash', revision.content_hash,
    'snapshot', revision.snapshot,
    'createdBy', revision.created_by,
    'createdAt', revision.created_at
  )
  FROM public.grant_document_revisions AS revision
  JOIN public.grant_documents AS document
    ON document.document_id = revision.document_id
  WHERE document.owner_id = p_owner_id
    AND revision.document_id = p_document_id
    AND revision.revision_id = p_revision_id;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_document_revisions(
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
    'revisionId', revision.revision_id,
    'documentId', revision.document_id,
    'revisionNumber', revision.revision_number,
    'parentRevisionId', revision.parent_revision_id,
    'templateSnapshotId', revision.template_snapshot_id,
    'contentHash', revision.content_hash,
    'createdBy', revision.created_by,
    'createdAt', revision.created_at
  ) ORDER BY revision.revision_number DESC), '[]'::jsonb)
  FROM public.grant_document_revisions AS revision
  JOIN public.grant_documents AS document
    ON document.document_id = revision.document_id
  WHERE document.owner_id = p_owner_id
    AND revision.document_id = p_document_id;
$$;

REVOKE ALL ON FUNCTION public.list_grant_documents(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_grant_document_revision(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_document_revisions(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_grant_documents(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_grant_document_revision(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_document_revisions(UUID, UUID) TO service_role;
