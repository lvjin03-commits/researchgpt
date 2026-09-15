-- Revision-bound, rebuildable semantic memory for the Grant Assistant.
-- Applying this migration does not enable the runtime by itself.

CREATE TABLE public.grant_document_memories (
  memory_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id) ON DELETE CASCADE,
  context_hash TEXT NOT NULL CHECK (context_hash ~ '^[a-f0-9]{64}$'),
  memory_hash TEXT NOT NULL CHECK (memory_hash ~ '^[a-f0-9]{64}$'),
  policy_version TEXT NOT NULL CHECK (length(btrim(policy_version)) > 0),
  snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (document_id, source_revision_id, context_hash, policy_version),
  CHECK ((snapshot->>'memoryId')::UUID = memory_id),
  CHECK ((snapshot->>'documentId')::UUID = document_id),
  CHECK ((snapshot->>'sourceRevisionId')::UUID = source_revision_id),
  CHECK (snapshot->>'contextHash' = context_hash),
  CHECK (snapshot->>'memoryHash' = memory_hash),
  CHECK (snapshot->>'policyVersion' = policy_version),
  CHECK (snapshot->>'schemaVersion' = 'grant-document-memory-v1'),
  CHECK (snapshot#>>'{coverage,complete}' = 'true')
);

CREATE INDEX grant_document_memories_lookup_idx
  ON public.grant_document_memories(document_id,source_revision_id,created_at DESC);
ALTER TABLE public.grant_document_memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grant_document_memories FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.find_reusable_grant_document_memory(
  p_owner_id UUID,p_document_id UUID,p_source_revision_id UUID,p_context_hash TEXT,p_policy_version TEXT
) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT memory.snapshot
  FROM public.grant_document_memories memory
  JOIN public.grant_documents document ON document.document_id=memory.document_id
  WHERE memory.document_id=p_document_id
    AND memory.source_revision_id=p_source_revision_id
    AND memory.context_hash=p_context_hash
    AND memory.policy_version=p_policy_version
    AND document.owner_id=p_owner_id
  LIMIT 1;
$$;

CREATE FUNCTION public.save_grant_document_memory(p_owner_id UUID,p_snapshot JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_document_id UUID; v_revision_id UUID; v_snapshot JSONB;
BEGIN
  v_document_id := (p_snapshot->>'documentId')::UUID;
  v_revision_id := (p_snapshot->>'sourceRevisionId')::UUID;
  IF NOT EXISTS(
    SELECT 1 FROM public.grant_documents document
    JOIN public.grant_document_revisions revision ON revision.document_id=document.document_id
    WHERE document.document_id=v_document_id AND document.owner_id=p_owner_id
      AND revision.revision_id=v_revision_id
  ) THEN RAISE EXCEPTION 'grant_document_revision_not_found'; END IF;
  IF p_snapshot->>'provider'<>'openai'
    OR p_snapshot->>'schemaVersion'<>'grant-document-memory-v1'
    OR p_snapshot#>>'{coverage,complete}'<>'true'
  THEN RAISE EXCEPTION 'grant_document_memory_invalid'; END IF;

  INSERT INTO public.grant_document_memories(
    memory_id,owner_id,document_id,source_revision_id,context_hash,memory_hash,
    policy_version,snapshot,created_at
  ) VALUES(
    (p_snapshot->>'memoryId')::UUID,p_owner_id,v_document_id,v_revision_id,
    p_snapshot->>'contextHash',p_snapshot->>'memoryHash',p_snapshot->>'policyVersion',
    p_snapshot,(p_snapshot->>'builtAt')::TIMESTAMPTZ
  ) ON CONFLICT(document_id,source_revision_id,context_hash,policy_version) DO NOTHING;

  SELECT memory.snapshot INTO v_snapshot FROM public.grant_document_memories memory
  WHERE memory.document_id=v_document_id AND memory.source_revision_id=v_revision_id
    AND memory.context_hash=p_snapshot->>'contextHash'
    AND memory.policy_version=p_snapshot->>'policyVersion';
  RETURN v_snapshot;
END; $$;

REVOKE ALL ON FUNCTION public.find_reusable_grant_document_memory(UUID,UUID,UUID,TEXT,TEXT),
  public.save_grant_document_memory(UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_reusable_grant_document_memory(UUID,UUID,UUID,TEXT,TEXT),
  public.save_grant_document_memory(UUID,JSONB) TO service_role;
