-- Hierarchical semantic diagnosis: durable Step A checkpoints, root-Finding
-- details and one V2/V3/V4 normalized read projection. This migration does
-- not select the V5 runtime or expose a new route.

CREATE TABLE IF NOT EXISTS public.grant_argument_map_checkpoints (
  checkpoint_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id) ON DELETE CASCADE,
  checker_id TEXT NOT NULL,
  checker_version TEXT NOT NULL,
  contract_version TEXT NOT NULL CHECK (contract_version = 'grant-semantic-diagnostic-v5'),
  input_fingerprint TEXT NOT NULL CHECK (input_fingerprint ~ '^[a-f0-9]{64}$'),
  location_scope_fingerprint TEXT NOT NULL CHECK (location_scope_fingerprint ~ '^[a-f0-9]{64}$'),
  argument_map JSONB NOT NULL CHECK (jsonb_typeof(argument_map) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('ready', 'consumed', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (document_id, source_revision_id, checker_id, checker_version, input_fingerprint, location_scope_fingerprint)
);

CREATE TABLE IF NOT EXISTS public.grant_semantic_finding_v4_contents (
  finding_id UUID PRIMARY KEY REFERENCES public.grant_findings(finding_id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL CHECK (schema_version = 'grant-semantic-finding-v4'),
  policy_version TEXT NOT NULL CHECK (policy_version = 'grant-ai-policy-v4'),
  contract_version TEXT NOT NULL CHECK (contract_version = 'grant-semantic-diagnostic-v5'),
  category TEXT NOT NULL,
  affected_argument_roles TEXT[] NOT NULL CHECK (cardinality(affected_argument_roles) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  diagnostic_fact TEXT NOT NULL CHECK (length(trim(diagnostic_fact)) > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  possible_consequence TEXT,
  evidence_basis TEXT NOT NULL CHECK (evidence_basis IN ('document_only', 'authorized_evidence', 'requires_external_verification')),
  used_evidence_card_ids UUID[] NOT NULL DEFAULT '{}',
  root_fingerprint TEXT NOT NULL CHECK (root_fingerprint ~ '^[a-f0-9]{64}$'),
  display_order INTEGER NOT NULL CHECK (display_order >= 0)
);

CREATE TABLE IF NOT EXISTS public.grant_semantic_finding_v4_occurrences (
  finding_id UUID NOT NULL REFERENCES public.grant_semantic_finding_v4_contents(finding_id) ON DELETE CASCADE,
  occurrence_order INTEGER NOT NULL CHECK (occurrence_order >= 0),
  occurrence_fingerprint TEXT NOT NULL CHECK (occurrence_fingerprint ~ '^[a-f0-9]{64}$'),
  primary_section_id UUID NOT NULL,
  primary_node_id UUID NOT NULL,
  primary_source_anchor JSONB NOT NULL CHECK (jsonb_typeof(primary_source_anchor) = 'object'),
  PRIMARY KEY (finding_id, occurrence_order),
  UNIQUE (finding_id, occurrence_fingerprint)
);

CREATE TABLE IF NOT EXISTS public.grant_semantic_finding_v4_related_locations (
  finding_id UUID NOT NULL,
  occurrence_order INTEGER NOT NULL,
  location_order INTEGER NOT NULL CHECK (location_order >= 0),
  section_id UUID NOT NULL,
  node_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'supporting_location', 'conflicting_location', 'upstream_dependency',
    'downstream_dependency', 'comparison_location', 'missing_expected_location'
  )),
  quote TEXT,
  source_anchor JSONB NOT NULL CHECK (jsonb_typeof(source_anchor) = 'object'),
  PRIMARY KEY (finding_id, occurrence_order, location_order),
  UNIQUE (finding_id, occurrence_order, section_id, node_id, role),
  FOREIGN KEY (finding_id, occurrence_order)
    REFERENCES public.grant_semantic_finding_v4_occurrences(finding_id, occurrence_order)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.grant_semantic_finding_v4_continuity (
  finding_id UUID PRIMARY KEY REFERENCES public.grant_semantic_finding_v4_contents(finding_id) ON DELETE CASCADE,
  previous_finding_id UUID NOT NULL REFERENCES public.grant_findings(finding_id),
  previous_root_fingerprint TEXT NOT NULL CHECK (previous_root_fingerprint ~ '^[a-f0-9]{64}$'),
  match_kind TEXT NOT NULL CHECK (match_kind IN ('exact', 'relocated'))
);

CREATE INDEX IF NOT EXISTS grant_argument_map_checkpoint_lookup_idx
  ON public.grant_argument_map_checkpoints (
    document_id, source_revision_id, checker_id, checker_version,
    input_fingerprint, location_scope_fingerprint, created_at DESC
  ) WHERE status = 'ready';

ALTER TABLE public.grant_argument_map_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_semantic_finding_v4_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_semantic_finding_v4_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_semantic_finding_v4_related_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_semantic_finding_v4_continuity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_argument_map_checkpoints FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_semantic_finding_v4_contents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_semantic_finding_v4_occurrences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_semantic_finding_v4_related_locations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_semantic_finding_v4_continuity FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_argument_map_checkpoints TO service_role;
GRANT SELECT ON TABLE public.grant_semantic_finding_v4_contents TO service_role;
GRANT SELECT ON TABLE public.grant_semantic_finding_v4_occurrences TO service_role;
GRANT SELECT ON TABLE public.grant_semantic_finding_v4_related_locations TO service_role;
GRANT SELECT ON TABLE public.grant_semantic_finding_v4_continuity TO service_role;

CREATE OR REPLACE FUNCTION public.save_grant_argument_map_checkpoint(
  p_owner_id UUID,
  p_checkpoint JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.grant_documents
    WHERE document_id = (p_checkpoint->>'documentId')::UUID AND owner_id = p_owner_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.grant_document_revisions
    WHERE revision_id = (p_checkpoint->>'sourceRevisionId')::UUID
      AND document_id = (p_checkpoint->>'documentId')::UUID
  ) THEN
    RAISE EXCEPTION 'grant checkpoint document or revision mismatch';
  END IF;
  IF p_checkpoint->>'contractVersion' IS DISTINCT FROM 'grant-semantic-diagnostic-v5'
    OR p_checkpoint->'argumentMap'->>'sourceRevisionId' IS DISTINCT FROM p_checkpoint->>'sourceRevisionId' THEN
    RAISE EXCEPTION 'grant checkpoint contract mismatch';
  END IF;

  INSERT INTO public.grant_argument_map_checkpoints (
    checkpoint_id, document_id, source_revision_id, checker_id, checker_version,
    contract_version, input_fingerprint, location_scope_fingerprint,
    argument_map, status, created_at
  ) VALUES (
    (p_checkpoint->>'checkpointId')::UUID, (p_checkpoint->>'documentId')::UUID,
    (p_checkpoint->>'sourceRevisionId')::UUID, p_checkpoint->>'checkerId',
    p_checkpoint->>'checkerVersion', p_checkpoint->>'contractVersion',
    p_checkpoint->>'inputFingerprint', p_checkpoint->>'locationScopeFingerprint',
    p_checkpoint->'argumentMap', p_checkpoint->>'status',
    (p_checkpoint->>'createdAt')::TIMESTAMPTZ
  )
  ON CONFLICT (
    document_id, source_revision_id, checker_id, checker_version,
    input_fingerprint, location_scope_fingerprint
  ) DO UPDATE SET
    argument_map = EXCLUDED.argument_map,
    status = EXCLUDED.status,
    created_at = EXCLUDED.created_at;

  RETURN (
    SELECT jsonb_build_object(
      'checkpointId', checkpoint.checkpoint_id,
      'documentId', checkpoint.document_id,
      'sourceRevisionId', checkpoint.source_revision_id,
      'checkerId', checkpoint.checker_id,
      'checkerVersion', checkpoint.checker_version,
      'contractVersion', checkpoint.contract_version,
      'inputFingerprint', checkpoint.input_fingerprint,
      'locationScopeFingerprint', checkpoint.location_scope_fingerprint,
      'argumentMap', checkpoint.argument_map,
      'status', checkpoint.status,
      'createdAt', checkpoint.created_at
    )
    FROM public.grant_argument_map_checkpoints AS checkpoint
    WHERE checkpoint.document_id = (p_checkpoint->>'documentId')::UUID
      AND checkpoint.source_revision_id = (p_checkpoint->>'sourceRevisionId')::UUID
      AND checkpoint.checker_id = p_checkpoint->>'checkerId'
      AND checkpoint.checker_version = p_checkpoint->>'checkerVersion'
      AND checkpoint.input_fingerprint = p_checkpoint->>'inputFingerprint'
      AND checkpoint.location_scope_fingerprint = p_checkpoint->>'locationScopeFingerprint'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.find_grant_argument_map_checkpoint(
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
    'checkpointId', checkpoint.checkpoint_id,
    'documentId', checkpoint.document_id,
    'sourceRevisionId', checkpoint.source_revision_id,
    'checkerId', checkpoint.checker_id,
    'checkerVersion', checkpoint.checker_version,
    'contractVersion', checkpoint.contract_version,
    'inputFingerprint', checkpoint.input_fingerprint,
    'locationScopeFingerprint', checkpoint.location_scope_fingerprint,
    'argumentMap', checkpoint.argument_map,
    'status', checkpoint.status,
    'createdAt', checkpoint.created_at
  )
  FROM public.grant_argument_map_checkpoints AS checkpoint
  JOIN public.grant_documents AS document ON document.document_id = checkpoint.document_id
  WHERE checkpoint.document_id = p_document_id
    AND document.owner_id = p_owner_id
    AND checkpoint.source_revision_id = p_source_revision_id
    AND checkpoint.checker_id = p_checker_id
    AND checkpoint.checker_version = p_checker_version
    AND checkpoint.input_fingerprint = p_input_fingerprint
    AND checkpoint.location_scope_fingerprint = p_location_scope_fingerprint
    AND checkpoint.status = 'ready'
  ORDER BY checkpoint.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.save_grant_hierarchical_diagnostic_execution(
  p_owner_id UUID,
  p_document_id UUID,
  p_run JSONB,
  p_findings JSONB,
  p_argument_map_checkpoint JSONB,
  p_continuity_links JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  occurrence JSONB;
  related JSONB;
  occurrence_ordinality BIGINT;
  related_ordinality BIGINT;
  continuity JSONB;
  compatibility_findings JSONB;
BEGIN
  IF jsonb_typeof(p_findings) <> 'array'
    OR jsonb_typeof(p_continuity_links) <> 'array'
    OR jsonb_typeof(p_argument_map_checkpoint) <> 'object' THEN
    RAISE EXCEPTION 'hierarchical diagnostic persistence payload mismatch';
  END IF;
  IF p_run->>'contractVersion' IS DISTINCT FROM 'grant-semantic-diagnostic-v5'
    OR p_argument_map_checkpoint->>'sourceRevisionId' IS DISTINCT FROM p_run->>'sourceRevisionId'
    OR p_argument_map_checkpoint->>'contractVersion' IS DISTINCT FROM p_run->>'contractVersion' THEN
    RAISE EXCEPTION 'hierarchical diagnostic execution contract mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.grant_documents
    WHERE document_id = p_document_id
      AND owner_id = p_owner_id
      AND current_revision_id = (p_run->>'sourceRevisionId')::UUID
  ) THEN
    RAISE EXCEPTION 'diagnostic_base_revision_stale';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'findingId', value->>'findingId', 'runId', value->>'runId',
    'documentId', value->>'documentId', 'sourceRevisionId', value->>'sourceRevisionId',
    'checkerId', value->>'checkerId', 'checkerVersion', value->>'checkerVersion',
    'fingerprint', value->>'fingerprint', 'code', value->>'category',
    'message', value->>'diagnosticFact', 'recommendation', value->>'recommendation',
    'assessment', value->'assessment', 'sourceAnchor', value->'sourceAnchor',
    'lifecycleStatus', value->>'lifecycleStatus', 'createdAt', value->>'createdAt'
  )), '[]'::jsonb)
  INTO compatibility_findings
  FROM jsonb_array_elements(p_findings);

  PERFORM public.save_grant_diagnostic_execution(
    p_owner_id, p_document_id, jsonb_build_array(p_run), compatibility_findings, '[]'::jsonb
  );

  FOR item IN SELECT value FROM jsonb_array_elements(p_findings) LOOP
    IF item->>'schemaVersion' IS DISTINCT FROM 'grant-semantic-finding-v4'
      OR item->>'contractVersion' IS DISTINCT FROM p_run->>'contractVersion'
      OR (item->>'runId')::UUID IS DISTINCT FROM (p_run->>'runId')::UUID
      OR (item->>'documentId')::UUID IS DISTINCT FROM p_document_id
      OR item->>'fingerprint' IS DISTINCT FROM item->>'rootFingerprint' THEN
      RAISE EXCEPTION 'hierarchical Finding envelope mismatch';
    END IF;

    INSERT INTO public.grant_semantic_finding_v4_contents (
      finding_id, schema_version, policy_version, contract_version, category,
      affected_argument_roles, title, diagnostic_fact, reason, possible_consequence,
      evidence_basis, used_evidence_card_ids, root_fingerprint, display_order
    ) VALUES (
      (item->>'findingId')::UUID, item->>'schemaVersion', item->>'policyVersion',
      item->>'contractVersion', item->>'category',
      ARRAY(SELECT jsonb_array_elements_text(item->'affectedArgumentRoles')),
      item->>'title', item->>'diagnosticFact', item->>'reason',
      NULLIF(item->>'possibleConsequence', ''), item->>'evidenceBasis',
      ARRAY(SELECT jsonb_array_elements_text(item->'usedEvidenceCardIds'))::UUID[],
      item->>'rootFingerprint', (item->>'displayOrder')::INTEGER
    );

    FOR occurrence, occurrence_ordinality IN
      SELECT value, ordinality FROM jsonb_array_elements(item->'occurrences') WITH ORDINALITY
    LOOP
      INSERT INTO public.grant_semantic_finding_v4_occurrences (
        finding_id, occurrence_order, occurrence_fingerprint,
        primary_section_id, primary_node_id, primary_source_anchor
      ) VALUES (
        (item->>'findingId')::UUID, (occurrence_ordinality - 1)::INTEGER,
        occurrence->>'occurrenceFingerprint',
        (occurrence->'primaryLocation'->>'sectionId')::UUID,
        (occurrence->'primaryLocation'->>'nodeId')::UUID,
        occurrence->'primarySourceAnchor'
      );
      FOR related, related_ordinality IN
        SELECT value, ordinality FROM jsonb_array_elements(occurrence->'relatedLocations') WITH ORDINALITY
      LOOP
        INSERT INTO public.grant_semantic_finding_v4_related_locations (
          finding_id, occurrence_order, location_order, section_id, node_id, role, quote, source_anchor
        ) VALUES (
          (item->>'findingId')::UUID, (occurrence_ordinality - 1)::INTEGER,
          (related_ordinality - 1)::INTEGER, (related->>'sectionId')::UUID,
          (related->>'nodeId')::UUID, related->>'role', NULLIF(related->>'quote', ''), related->'sourceAnchor'
        );
      END LOOP;
    END LOOP;
  END LOOP;

  PERFORM public.save_grant_argument_map_checkpoint(
    p_owner_id, p_argument_map_checkpoint || jsonb_build_object('status', 'consumed')
  );
  FOR continuity IN SELECT value FROM jsonb_array_elements(p_continuity_links) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.grant_semantic_finding_v4_contents
      WHERE finding_id = (continuity->>'findingId')::UUID
    ) OR NOT EXISTS (
      SELECT 1 FROM public.grant_findings
      WHERE finding_id = (continuity->>'previousFindingId')::UUID
        AND document_id = p_document_id
    ) THEN
      RAISE EXCEPTION 'hierarchical continuity link mismatch';
    END IF;
    INSERT INTO public.grant_semantic_finding_v4_continuity (
      finding_id, previous_finding_id, previous_root_fingerprint, match_kind
    ) VALUES (
      (continuity->>'findingId')::UUID, (continuity->>'previousFindingId')::UUID,
      continuity->>'previousRootFingerprint', continuity->>'match'
    );
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_normalized_findings(p_owner_id UUID, p_document_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'findingId', finding.finding_id, 'runId', finding.run_id,
    'documentId', finding.document_id, 'sourceRevisionId', finding.source_revision_id,
    'checkerId', finding.checker_id, 'checkerVersion', finding.checker_version,
    'contractVersion', run.contract_version,
    'schemaVersion', COALESCE(v4.schema_version, v3.schema_version, 'grant-finding-v2'),
    'policyVersion', COALESCE(v4.policy_version, v3.policy_version),
    'fingerprint', finding.fingerprint, 'category', COALESCE(v4.category, v3.category, finding.code),
    'title', COALESCE(v4.title, v3.title),
    'diagnosticFact', COALESCE(v4.diagnostic_fact, v3.diagnostic_fact, finding.message),
    'reason', COALESCE(v4.reason, v3.reason), 'recommendation', finding.recommendation,
    'possibleConsequence', COALESCE(v4.possible_consequence, v3.possible_consequence),
    'assessment', finding.assessment, 'sourceAnchor', finding.source_anchor,
    'relatedLocations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sectionId', location.section_id, 'nodeId', location.node_id,
        'role', location.role, 'quote', location.quote
      ) ORDER BY location.location_order)
      FROM public.grant_semantic_finding_v3_locations AS location
      WHERE location.finding_id = finding.finding_id
    ), '[]'::jsonb),
    'affectedArgumentRoles', COALESCE(to_jsonb(v4.affected_argument_roles), '[]'::jsonb),
    'evidenceBasis', v4.evidence_basis,
    'rootOccurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'occurrenceFingerprint', occurrence.occurrence_fingerprint,
        'primaryLocation', jsonb_build_object(
          'sectionId', occurrence.primary_section_id, 'nodeId', occurrence.primary_node_id
        ),
        'primarySourceAnchor', occurrence.primary_source_anchor,
        'relatedLocations', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'sectionId', related.section_id, 'nodeId', related.node_id,
            'role', related.role, 'quote', related.quote, 'sourceAnchor', related.source_anchor
          ) ORDER BY related.location_order)
          FROM public.grant_semantic_finding_v4_related_locations AS related
          WHERE related.finding_id = occurrence.finding_id
            AND related.occurrence_order = occurrence.occurrence_order
        ), '[]'::jsonb)
      ) ORDER BY occurrence.occurrence_order)
      FROM public.grant_semantic_finding_v4_occurrences AS occurrence
      WHERE occurrence.finding_id = finding.finding_id
    ), '[]'::jsonb),
    'usedEvidenceCardIds', COALESCE(
      to_jsonb(v4.used_evidence_card_ids), to_jsonb(v3.used_evidence_card_ids), '[]'::jsonb
    ),
    'displayOrder', COALESCE(v4.display_order, v3.display_order),
    'lifecycleStatus', finding.lifecycle_status, 'createdAt', finding.created_at
  ) ORDER BY finding.created_at DESC, COALESCE(v4.display_order, v3.display_order) NULLS LAST, finding.finding_id), '[]'::jsonb)
  FROM public.grant_findings AS finding
  JOIN public.grant_diagnostic_runs AS run ON run.run_id = finding.run_id
  JOIN public.grant_documents AS document ON document.document_id = finding.document_id
  LEFT JOIN public.grant_semantic_finding_v3_contents AS v3 ON v3.finding_id = finding.finding_id
  LEFT JOIN public.grant_semantic_finding_v4_contents AS v4 ON v4.finding_id = finding.finding_id
  WHERE finding.document_id = p_document_id AND document.owner_id = p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.save_grant_argument_map_checkpoint(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_grant_argument_map_checkpoint(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_grant_hierarchical_diagnostic_execution(UUID, UUID, JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_grant_argument_map_checkpoint(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.find_grant_argument_map_checkpoint(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_grant_hierarchical_diagnostic_execution(UUID, UUID, JSONB, JSONB, JSONB, JSONB) TO service_role;

COMMENT ON TABLE public.grant_argument_map_checkpoints IS
  'Revision-bound recovery checkpoints only; never durable Finding identity.';
COMMENT ON TABLE public.grant_semantic_finding_v4_contents IS
  'Root-cause semantic content attached to the existing grant_findings envelope.';
