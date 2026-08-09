-- Recoverable owner-scoped deletion for grant documents. Canonical revisions,
-- evidence and audit history remain durable until a separately governed purge.

ALTER TABLE public.grant_documents
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.grant_audit_events
  DROP CONSTRAINT IF EXISTS grant_audit_events_event_type_check;
ALTER TABLE public.grant_audit_events
  ADD CONSTRAINT grant_audit_events_event_type_check
  CHECK (event_type IN ('document_created', 'revision_committed', 'document_archived'));

CREATE OR REPLACE FUNCTION public.reject_archived_grant_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.grant_documents
    WHERE document_id = NEW.document_id
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'archived grant documents cannot receive new revisions';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS grant_document_revisions_reject_archived ON public.grant_document_revisions;
CREATE TRIGGER grant_document_revisions_reject_archived
BEFORE INSERT ON public.grant_document_revisions
FOR EACH ROW EXECUTE FUNCTION public.reject_archived_grant_revision();

CREATE OR REPLACE FUNCTION public.archive_grant_document(
  p_owner_id UUID,
  p_document_id UUID,
  p_expected_revision_id UUID,
  p_actor_id UUID,
  p_audit_event_id UUID,
  p_audit_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_document public.grant_documents;
  archived_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_actor_id IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'grant archive actor must be the owner';
  END IF;

  SELECT * INTO current_document
  FROM public.grant_documents
  WHERE document_id = p_document_id
    AND owner_id = p_owner_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF current_document.current_revision_id IS DISTINCT FROM p_expected_revision_id THEN
    RETURN jsonb_build_object(
      'status', 'revision_conflict',
      'currentRevisionId', current_document.current_revision_id
    );
  END IF;

  UPDATE public.grant_documents
  SET deleted_at = archived_at,
      deleted_by = p_actor_id,
      updated_at = archived_at
  WHERE document_id = p_document_id
    AND owner_id = p_owner_id
    AND current_revision_id = p_expected_revision_id
    AND deleted_at IS NULL;

  INSERT INTO public.grant_audit_events (
    audit_event_id, document_id, revision_id, actor_id, actor_kind,
    event_type, metadata, created_at
  ) VALUES (
    p_audit_event_id, p_document_id, p_expected_revision_id, p_actor_id, 'user',
    'document_archived', p_audit_metadata, archived_at
  );

  RETURN jsonb_build_object('status', 'archived');
END;
$$;

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
  WHERE document.owner_id = p_owner_id
    AND document.deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.get_grant_document_aggregate(
  p_owner_id UUID,
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'document', jsonb_build_object(
      'documentId', document.document_id,
      'ownerId', document.owner_id,
      'title', document.title,
      'templateSnapshotId', document.template_snapshot_id,
      'currentRevisionId', document.current_revision_id,
      'currentRevisionNumber', document.current_revision_number,
      'createdAt', document.created_at,
      'updatedAt', document.updated_at
    ),
    'currentRevision', jsonb_build_object(
      'revisionId', revision.revision_id,
      'documentId', revision.document_id,
      'revisionNumber', revision.revision_number,
      'parentRevisionId', revision.parent_revision_id,
      'templateSnapshotId', revision.template_snapshot_id,
      'contentHash', revision.content_hash,
      'snapshot', revision.snapshot,
      'createdBy', revision.created_by,
      'createdAt', revision.created_at
    ),
    'templateSnapshot', jsonb_build_object(
      'templateSnapshotId', template.template_snapshot_id,
      'ownerId', template.owner_id,
      'templateKey', template.template_key,
      'templateVersion', template.template_version,
      'rules', template.rules,
      'checksum', template.checksum,
      'createdAt', template.created_at
    )
  )
  FROM public.grant_documents AS document
  JOIN public.grant_document_revisions AS revision
    ON revision.revision_id = document.current_revision_id
  JOIN public.grant_template_snapshots AS template
    ON template.template_snapshot_id = document.template_snapshot_id
  WHERE document.document_id = p_document_id
    AND document.owner_id = p_owner_id
    AND document.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.archive_grant_document(UUID, UUID, UUID, UUID, UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_archived_grant_revision()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_grant_document(UUID, UUID, UUID, UUID, UUID, JSONB)
  TO service_role;

COMMENT ON COLUMN public.grant_documents.deleted_at IS
  'Recoverable user-facing deletion timestamp. Archived documents are excluded from active projections.';
