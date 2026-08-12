-- Target-only Semantic Review V6 recovery and atomic result persistence.
-- This migration does not select V6 runtime or expose a new route.

CREATE TABLE IF NOT EXISTS public.grant_semantic_review_v6_checkpoints (
  checkpoint_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id) ON DELETE CASCADE,
  checker_id TEXT NOT NULL,
  checker_version TEXT NOT NULL CHECK (checker_version = '6.0.0'),
  contract_version TEXT NOT NULL CHECK (contract_version = 'grant-semantic-diagnostic-v6'),
  input_fingerprint TEXT NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  location_scope_fingerprint TEXT NOT NULL CHECK (location_scope_fingerprint ~ '^[a-f0-9]{64}$'),
  mature_stage TEXT NOT NULL CHECK (mature_stage IN ('fact_map', 'scientific_review')),
  fact_map JSONB NOT NULL CHECK (jsonb_typeof(fact_map) = 'object'),
  scientific_review JSONB CHECK (scientific_review IS NULL OR jsonb_typeof(scientific_review) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('ready', 'consumed', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (document_id, source_revision_id, checker_id, checker_version, input_fingerprint, location_scope_fingerprint),
  CHECK ((mature_stage = 'scientific_review') = (scientific_review IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.grant_semantic_review_v6_finding_details (
  finding_id UUID PRIMARY KEY REFERENCES public.grant_findings(finding_id) ON DELETE CASCADE,
  family TEXT NOT NULL CHECK (family IN ('scientific', 'narrative')),
  schema_version TEXT NOT NULL CHECK (schema_version IN ('grant-scientific-finding-v1', 'grant-narrative-finding-v1')),
  policy_version TEXT NOT NULL CHECK (policy_version = 'grant-ai-policy-v5'),
  contract_version TEXT NOT NULL CHECK (contract_version = 'grant-semantic-diagnostic-v6'),
  display_order INTEGER NOT NULL CHECK (display_order >= 0),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  CHECK (
    (family = 'scientific' AND schema_version = 'grant-scientific-finding-v1')
    OR (family = 'narrative' AND schema_version = 'grant-narrative-finding-v1')
  )
);

CREATE INDEX IF NOT EXISTS grant_semantic_review_v6_checkpoint_lookup_idx
  ON public.grant_semantic_review_v6_checkpoints (
    document_id, source_revision_id, checker_id, checker_version,
    input_fingerprint, location_scope_fingerprint, created_at DESC
  ) WHERE status = 'ready';

ALTER TABLE public.grant_semantic_review_v6_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_semantic_review_v6_finding_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_semantic_review_v6_checkpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_semantic_review_v6_finding_details FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_semantic_review_v6_checkpoints TO service_role;
GRANT SELECT ON TABLE public.grant_semantic_review_v6_finding_details TO service_role;

CREATE OR REPLACE FUNCTION public.save_grant_semantic_review_v6_checkpoint(
  p_owner_id UUID,
  p_checkpoint JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored public.grant_semantic_review_v6_checkpoints%ROWTYPE;
BEGIN
  IF p_checkpoint->>'contractVersion' IS DISTINCT FROM 'grant-semantic-diagnostic-v6'
    OR p_checkpoint->>'checkerVersion' IS DISTINCT FROM '6.0.0'
    OR p_checkpoint->'factMap'->>'sourceRevisionId' IS DISTINCT FROM p_checkpoint->>'sourceRevisionId'
    OR p_checkpoint->'factMap'->>'locationScopeFingerprint' IS DISTINCT FROM p_checkpoint->>'locationScopeFingerprint'
    OR ((p_checkpoint->>'matureStage' = 'scientific_review') IS DISTINCT FROM (jsonb_typeof(p_checkpoint->'scientificReview') = 'object')) THEN
    RAISE EXCEPTION 'semantic review v6 checkpoint contract mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.grant_documents
    WHERE document_id = (p_checkpoint->>'documentId')::UUID
      AND owner_id = p_owner_id
      AND current_revision_id = (p_checkpoint->>'sourceRevisionId')::UUID
  ) THEN
    RAISE EXCEPTION 'diagnostic_base_revision_stale';
  END IF;

  INSERT INTO public.grant_semantic_review_v6_checkpoints (
    checkpoint_id, document_id, source_revision_id, checker_id, checker_version,
    contract_version, input_fingerprint, location_scope_fingerprint, mature_stage,
    fact_map, scientific_review, status, created_at
  ) VALUES (
    (p_checkpoint->>'checkpointId')::UUID, (p_checkpoint->>'documentId')::UUID,
    (p_checkpoint->>'sourceRevisionId')::UUID, p_checkpoint->>'checkerId',
    p_checkpoint->>'checkerVersion', p_checkpoint->>'contractVersion',
    p_checkpoint->>'inputFingerprint', p_checkpoint->>'locationScopeFingerprint',
    p_checkpoint->>'matureStage', p_checkpoint->'factMap',
    NULLIF(p_checkpoint->'scientificReview', 'null'::jsonb), p_checkpoint->>'status',
    (p_checkpoint->>'createdAt')::TIMESTAMPTZ
  )
  ON CONFLICT (document_id, source_revision_id, checker_id, checker_version, input_fingerprint, location_scope_fingerprint)
  DO UPDATE SET
    mature_stage = EXCLUDED.mature_stage,
    fact_map = EXCLUDED.fact_map,
    scientific_review = EXCLUDED.scientific_review,
    status = EXCLUDED.status,
    created_at = EXCLUDED.created_at
  RETURNING * INTO stored;

  RETURN jsonb_build_object(
    'checkpointId', stored.checkpoint_id, 'documentId', stored.document_id,
    'sourceRevisionId', stored.source_revision_id, 'checkerId', stored.checker_id,
    'checkerVersion', stored.checker_version, 'contractVersion', stored.contract_version,
    'inputFingerprint', stored.input_fingerprint,
    'locationScopeFingerprint', stored.location_scope_fingerprint,
    'matureStage', stored.mature_stage, 'factMap', stored.fact_map,
    'scientificReview', stored.scientific_review, 'status', stored.status,
    'createdAt', stored.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.find_grant_semantic_review_v6_checkpoint(
  p_owner_id UUID,
  p_document_id UUID,
  p_source_revision_id UUID,
  p_checker_id TEXT,
  p_checker_version TEXT,
  p_input_fingerprint TEXT,
  p_location_scope_fingerprint TEXT
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'checkpointId', checkpoint.checkpoint_id, 'documentId', checkpoint.document_id,
    'sourceRevisionId', checkpoint.source_revision_id, 'checkerId', checkpoint.checker_id,
    'checkerVersion', checkpoint.checker_version, 'contractVersion', checkpoint.contract_version,
    'inputFingerprint', checkpoint.input_fingerprint,
    'locationScopeFingerprint', checkpoint.location_scope_fingerprint,
    'matureStage', checkpoint.mature_stage, 'factMap', checkpoint.fact_map,
    'scientificReview', checkpoint.scientific_review, 'status', checkpoint.status,
    'createdAt', checkpoint.created_at
  )
  FROM public.grant_semantic_review_v6_checkpoints AS checkpoint
  JOIN public.grant_documents AS document ON document.document_id = checkpoint.document_id
  WHERE checkpoint.document_id = p_document_id
    AND document.owner_id = p_owner_id
    AND document.current_revision_id = p_source_revision_id
    AND checkpoint.source_revision_id = p_source_revision_id
    AND checkpoint.checker_id = p_checker_id
    AND checkpoint.checker_version = p_checker_version
    AND checkpoint.input_fingerprint = p_input_fingerprint
    AND checkpoint.location_scope_fingerprint = p_location_scope_fingerprint
    AND checkpoint.status = 'ready'
  ORDER BY checkpoint.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.save_grant_semantic_review_v6_execution(
  p_owner_id UUID,
  p_document_id UUID,
  p_run JSONB,
  p_findings JSONB,
  p_finding_details JSONB,
  p_checkpoint JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  detail JSONB;
BEGIN
  IF jsonb_typeof(p_findings) <> 'array'
    OR jsonb_typeof(p_finding_details) <> 'array'
    OR jsonb_typeof(p_checkpoint) <> 'object'
    OR jsonb_array_length(p_findings) IS DISTINCT FROM jsonb_array_length(p_finding_details) THEN
    RAISE EXCEPTION 'semantic review v6 persistence payload mismatch';
  END IF;
  IF p_run->>'contractVersion' IS DISTINCT FROM 'grant-semantic-diagnostic-v6'
    OR p_run->>'checkerVersion' IS DISTINCT FROM '6.0.0'
    OR p_checkpoint->>'sourceRevisionId' IS DISTINCT FROM p_run->>'sourceRevisionId'
    OR p_checkpoint->>'contractVersion' IS DISTINCT FROM p_run->>'contractVersion'
    OR p_checkpoint->>'matureStage' IS DISTINCT FROM 'scientific_review' THEN
    RAISE EXCEPTION 'semantic review v6 execution contract mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.grant_documents
    WHERE document_id = p_document_id
      AND owner_id = p_owner_id
      AND current_revision_id = (p_run->>'sourceRevisionId')::UUID
  ) THEN
    RAISE EXCEPTION 'diagnostic_base_revision_stale';
  END IF;

  PERFORM public.save_grant_diagnostic_execution(
    p_owner_id, p_document_id, jsonb_build_array(p_run), p_findings, '[]'::jsonb
  );

  FOR detail IN SELECT value FROM jsonb_array_elements(p_finding_details) LOOP
    IF detail->>'contractVersion' IS DISTINCT FROM p_run->>'contractVersion'
      OR NOT EXISTS (
        SELECT 1 FROM public.grant_findings
        WHERE finding_id = (detail->>'findingId')::UUID
          AND run_id = (p_run->>'runId')::UUID
          AND document_id = p_document_id
      ) THEN
      RAISE EXCEPTION 'semantic review v6 Finding detail mismatch';
    END IF;
    INSERT INTO public.grant_semantic_review_v6_finding_details (
      finding_id, family, schema_version, policy_version, contract_version,
      display_order, content
    ) VALUES (
      (detail->>'findingId')::UUID, detail->>'family', detail->>'schemaVersion',
      detail->>'policyVersion', detail->>'contractVersion',
      (detail->>'displayOrder')::INTEGER, detail->'content'
    );
  END LOOP;

  PERFORM public.save_grant_semantic_review_v6_checkpoint(
    p_owner_id, p_checkpoint || jsonb_build_object('status', 'consumed')
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.save_grant_semantic_review_v6_checkpoint(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_grant_semantic_review_v6_checkpoint(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_grant_semantic_review_v6_execution(UUID, UUID, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_grant_semantic_review_v6_checkpoint(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_grant_semantic_review_v6_checkpoint(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_grant_semantic_review_v6_execution(UUID, UUID, JSONB, JSONB, JSONB, JSONB) TO service_role;

COMMENT ON TABLE public.grant_semantic_review_v6_checkpoints IS
  'Revision-bound V6 recovery state only; never durable Finding identity.';
COMMENT ON TABLE public.grant_semantic_review_v6_finding_details IS
  'Scientific and narrative V6 detail attached to the existing immutable Finding envelope.';
