-- Replace the active Grant Assistant memory contract with explicit L0/L1/L2 layers.
-- Existing v1 rows remain auditable. The RPC accepts v1 during rolling deployment;
-- schema marker 074 activates the single v2 runtime path.

DO $$
DECLARE v_constraint_name TEXT;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid='public.grant_document_memories'::regclass
    AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%schemaVersion%grant-document-memory-v1%'
  LIMIT 1;
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.grant_document_memories DROP CONSTRAINT %I',v_constraint_name);
  END IF;
END; $$;

ALTER TABLE public.grant_document_memories
  ADD CONSTRAINT grant_document_memories_schema_version_check
  CHECK (snapshot->>'schemaVersion' IN ('grant-document-memory-v1','grant-document-memory-v2'));

CREATE OR REPLACE FUNCTION public.save_grant_document_memory(p_owner_id UUID,p_snapshot JSONB)
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
    OR p_snapshot->>'schemaVersion' NOT IN ('grant-document-memory-v1','grant-document-memory-v2')
    OR (p_snapshot->>'schemaVersion'='grant-document-memory-v2' AND (
      jsonb_typeof(p_snapshot->'l0')<>'object'
      OR jsonb_typeof(p_snapshot->'l1')<>'object'
      OR jsonb_typeof(p_snapshot->'l2')<>'object'
    ))
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

REVOKE ALL ON FUNCTION public.save_grant_document_memory(UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_grant_document_memory(UUID,JSONB) TO service_role;
