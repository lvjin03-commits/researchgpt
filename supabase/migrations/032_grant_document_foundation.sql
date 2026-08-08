-- Additive foundation for the isolated NSFC grant collaboration bounded context.
-- No existing chat, Document V2, literature, or exploration table is changed.

CREATE TABLE IF NOT EXISTS public.grant_template_snapshots (
  template_snapshot_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL CHECK (length(trim(template_key)) > 0),
  template_version TEXT NOT NULL CHECK (length(trim(template_version)) > 0),
  rules JSONB NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.grant_documents (
  document_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  template_snapshot_id UUID NOT NULL REFERENCES public.grant_template_snapshots(template_snapshot_id),
  current_revision_id UUID,
  current_revision_number INTEGER NOT NULL DEFAULT 0 CHECK (current_revision_number >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.grant_document_revisions (
  revision_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  parent_revision_id UUID REFERENCES public.grant_document_revisions(revision_id),
  template_snapshot_id UUID NOT NULL REFERENCES public.grant_template_snapshots(template_snapshot_id),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (document_id, revision_number),
  UNIQUE (document_id, content_hash, revision_number)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'grant_documents_current_revision_fk'
  ) THEN
    ALTER TABLE public.grant_documents
      ADD CONSTRAINT grant_documents_current_revision_fk
      FOREIGN KEY (current_revision_id)
      REFERENCES public.grant_document_revisions(revision_id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.grant_audit_events (
  audit_event_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'system', 'ai')),
  event_type TEXT NOT NULL CHECK (event_type IN ('document_created', 'revision_committed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS grant_documents_owner_updated_idx
  ON public.grant_documents (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS grant_document_revisions_document_number_idx
  ON public.grant_document_revisions (document_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS grant_audit_events_document_created_idx
  ON public.grant_audit_events (document_id, created_at ASC);

CREATE OR REPLACE FUNCTION public.reject_grant_immutable_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS grant_template_snapshots_immutable ON public.grant_template_snapshots;
CREATE TRIGGER grant_template_snapshots_immutable
BEFORE UPDATE ON public.grant_template_snapshots
FOR EACH ROW EXECUTE FUNCTION public.reject_grant_immutable_change();

DROP TRIGGER IF EXISTS grant_document_revisions_immutable ON public.grant_document_revisions;
CREATE TRIGGER grant_document_revisions_immutable
BEFORE UPDATE ON public.grant_document_revisions
FOR EACH ROW EXECUTE FUNCTION public.reject_grant_immutable_change();

DROP TRIGGER IF EXISTS grant_audit_events_immutable ON public.grant_audit_events;
CREATE TRIGGER grant_audit_events_immutable
BEFORE UPDATE ON public.grant_audit_events
FOR EACH ROW EXECUTE FUNCTION public.reject_grant_immutable_change();

ALTER TABLE public.grant_template_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_document_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.grant_template_snapshots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_documents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_document_revisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_template_snapshots TO service_role;
GRANT SELECT ON TABLE public.grant_documents TO service_role;
GRANT SELECT ON TABLE public.grant_document_revisions TO service_role;
GRANT SELECT ON TABLE public.grant_audit_events TO service_role;

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
  created_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_owner_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'initial document actor must be the owner';
  END IF;

  INSERT INTO public.grant_template_snapshots (
    template_snapshot_id, owner_id, template_key, template_version, rules, checksum, created_at
  ) VALUES (
    p_template_snapshot_id, p_owner_id, p_template_key, p_template_version,
    p_template_rules, p_template_checksum, created_at
  );

  INSERT INTO public.grant_documents (
    document_id, owner_id, title, template_snapshot_id,
    current_revision_number, created_at, updated_at
  ) VALUES (
    p_document_id, p_owner_id, p_title, p_template_snapshot_id, 0, created_at, created_at
  );

  INSERT INTO public.grant_document_revisions (
    revision_id, document_id, revision_number, template_snapshot_id,
    content_hash, snapshot, created_by, created_at
  ) VALUES (
    p_revision_id, p_document_id, 1, p_template_snapshot_id,
    p_content_hash, p_snapshot, p_actor_id, created_at
  );

  UPDATE public.grant_documents
  SET current_revision_id = p_revision_id,
      current_revision_number = 1,
      updated_at = created_at
  WHERE document_id = p_document_id
  RETURNING * INTO created_document;

  INSERT INTO public.grant_audit_events (
    audit_event_id, document_id, revision_id, actor_id, actor_kind,
    event_type, metadata, created_at
  ) VALUES (
    p_audit_event_id, p_document_id, p_revision_id, p_actor_id, 'user',
    'document_created', p_audit_metadata, created_at
  );

  RETURN created_document;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_grant_document_revision(
  p_owner_id UUID,
  p_document_id UUID,
  p_expected_revision_id UUID,
  p_revision_id UUID,
  p_content_hash TEXT,
  p_snapshot JSONB,
  p_actor_id UUID,
  p_actor_kind TEXT,
  p_audit_event_id UUID,
  p_audit_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_document public.grant_documents;
  committed_at TIMESTAMPTZ := clock_timestamp();
  next_revision_number INTEGER;
BEGIN
  SELECT * INTO current_document
  FROM public.grant_documents
  WHERE document_id = p_document_id AND owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant document not found';
  END IF;
  IF current_document.current_revision_id IS DISTINCT FROM p_expected_revision_id THEN
    RETURN FALSE;
  END IF;
  IF p_actor_kind NOT IN ('user', 'system', 'ai') THEN
    RAISE EXCEPTION 'invalid actor kind';
  END IF;

  next_revision_number := current_document.current_revision_number + 1;
  INSERT INTO public.grant_document_revisions (
    revision_id, document_id, revision_number, parent_revision_id,
    template_snapshot_id, content_hash, snapshot, created_by, created_at
  ) VALUES (
    p_revision_id, p_document_id, next_revision_number,
    current_document.current_revision_id, current_document.template_snapshot_id,
    p_content_hash, p_snapshot, p_actor_id, committed_at
  );

  UPDATE public.grant_documents
  SET title = COALESCE(NULLIF(trim(p_snapshot->>'title'), ''), title),
      current_revision_id = p_revision_id,
      current_revision_number = next_revision_number,
      updated_at = committed_at
  WHERE document_id = p_document_id
    AND current_revision_id = p_expected_revision_id;

  INSERT INTO public.grant_audit_events (
    audit_event_id, document_id, revision_id, actor_id, actor_kind,
    event_type, metadata, created_at
  ) VALUES (
    p_audit_event_id, p_document_id, p_revision_id, p_actor_id, p_actor_kind,
    'revision_committed', p_audit_metadata, committed_at
  );
  RETURN TRUE;
END;
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
    AND document.owner_id = p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_audit_events(
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
    'auditEventId', audit.audit_event_id,
    'documentId', audit.document_id,
    'revisionId', audit.revision_id,
    'actorId', audit.actor_id,
    'actorKind', audit.actor_kind,
    'eventType', audit.event_type,
    'metadata', audit.metadata,
    'createdAt', audit.created_at
  ) ORDER BY audit.created_at, audit.audit_event_id), '[]'::jsonb)
  FROM public.grant_audit_events AS audit
  JOIN public.grant_documents AS document
    ON document.document_id = audit.document_id
  WHERE audit.document_id = p_document_id
    AND document.owner_id = p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.create_grant_document_foundation(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT, JSONB, UUID, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_grant_immutable_change()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_grant_document_revision(
  UUID, UUID, UUID, UUID, TEXT, JSONB, UUID, TEXT, UUID, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_grant_document_aggregate(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_audit_events(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_grant_document_foundation(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, JSONB, TEXT, UUID, TEXT, JSONB, UUID, UUID, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_grant_document_revision(
  UUID, UUID, UUID, UUID, TEXT, JSONB, UUID, TEXT, UUID, JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_grant_document_aggregate(UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_audit_events(UUID, UUID)
  TO service_role;

COMMENT ON TABLE public.grant_documents IS
  'Canonical NSFC grant documents. Current revision advances only through Revision Service RPCs.';
