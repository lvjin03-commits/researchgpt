-- Fix PL/pgSQL ambiguity between the composite return field `created_at`
-- and the function-local timestamp used for the atomic foundation write.

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
  p_audit_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.grant_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_document public.grant_documents;
  v_created_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_owner_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'initial document actor must be the owner';
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
    'document_created', p_audit_metadata, v_created_at
  );

  RETURN created_document;
END;
$$;
