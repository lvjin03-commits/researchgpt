-- Semantic Diagnostic V3 additive storage and one normalized repository projection.
-- V2 rows stay immutable; production readers are not switched by this migration.

CREATE TABLE IF NOT EXISTS public.grant_semantic_finding_v3_contents (
  finding_id UUID PRIMARY KEY REFERENCES public.grant_findings(finding_id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL CHECK (schema_version = 'grant-semantic-finding-v3'),
  policy_version TEXT NOT NULL CHECK (length(trim(policy_version)) > 0),
  contract_version TEXT NOT NULL CHECK (length(trim(contract_version)) > 0),
  category TEXT NOT NULL CHECK (category IN (
    'scientific_question_gap', 'argument_chain_gap', 'innovation_gap',
    'feasibility_support_gap', 'objective_content_route_gap',
    'research_design_gap', 'evidence_support_gap', 'cross_section_inconsistency'
  )),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  diagnostic_fact TEXT NOT NULL CHECK (length(trim(diagnostic_fact)) > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  possible_consequence TEXT,
  used_evidence_card_ids UUID[] NOT NULL DEFAULT '{}',
  display_order INTEGER NOT NULL CHECK (display_order >= 0)
);

CREATE TABLE IF NOT EXISTS public.grant_semantic_finding_v3_locations (
  finding_id UUID NOT NULL REFERENCES public.grant_semantic_finding_v3_contents(finding_id) ON DELETE CASCADE,
  location_order INTEGER NOT NULL CHECK (location_order >= 0),
  section_id UUID NOT NULL,
  node_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'supporting_location', 'conflicting_location', 'upstream_dependency',
    'downstream_dependency', 'comparison_location', 'missing_expected_location'
  )),
  quote TEXT,
  PRIMARY KEY (finding_id, location_order),
  UNIQUE (finding_id, section_id, node_id, role)
);

CREATE INDEX IF NOT EXISTS grant_semantic_finding_v3_category_idx
  ON public.grant_semantic_finding_v3_contents (category, finding_id);

ALTER TABLE public.grant_semantic_finding_v3_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_semantic_finding_v3_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_semantic_finding_v3_contents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_semantic_finding_v3_locations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_semantic_finding_v3_contents TO service_role;
GRANT SELECT ON TABLE public.grant_semantic_finding_v3_locations TO service_role;

CREATE OR REPLACE FUNCTION public.save_grant_semantic_v3_execution(
  p_owner_id UUID,
  p_document_id UUID,
  p_run JSONB,
  p_findings JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  location JSONB;
  location_ordinality BIGINT;
  compatibility_findings JSONB;
BEGIN
  IF jsonb_typeof(p_run) <> 'object' OR jsonb_typeof(p_findings) <> 'array' THEN
    RAISE EXCEPTION 'semantic V3 execution requires one run object and a Finding array';
  END IF;
  IF p_run->>'contractVersion' IS DISTINCT FROM 'grant-semantic-diagnostic-v3' THEN
    RAISE EXCEPTION 'semantic V3 run contract mismatch';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'findingId', value->>'findingId',
    'runId', value->>'runId',
    'documentId', value->>'documentId',
    'sourceRevisionId', value->>'sourceRevisionId',
    'checkerId', value->>'checkerId',
    'checkerVersion', value->>'checkerVersion',
    'fingerprint', value->>'fingerprint',
    'code', value->>'category',
    'message', value->>'diagnosticFact',
    'recommendation', value->>'recommendation',
    'assessment', value->'assessment',
    'sourceAnchor', value->'sourceAnchor',
    'lifecycleStatus', value->>'lifecycleStatus',
    'createdAt', value->>'createdAt'
  )), '[]'::jsonb)
  INTO compatibility_findings
  FROM jsonb_array_elements(p_findings);

  PERFORM public.save_grant_diagnostic_execution(
    p_owner_id,
    p_document_id,
    jsonb_build_array(p_run),
    compatibility_findings,
    '[]'::jsonb
  );

  FOR item IN SELECT value FROM jsonb_array_elements(p_findings) LOOP
    IF item->>'schemaVersion' IS DISTINCT FROM 'grant-semantic-finding-v3'
      OR item->>'contractVersion' IS DISTINCT FROM p_run->>'contractVersion'
      OR (item->>'runId')::UUID IS DISTINCT FROM (p_run->>'runId')::UUID
      OR (item->>'documentId')::UUID IS DISTINCT FROM p_document_id THEN
      RAISE EXCEPTION 'semantic V3 Finding envelope mismatch';
    END IF;

    INSERT INTO public.grant_semantic_finding_v3_contents (
      finding_id, schema_version, policy_version, contract_version, category,
      title, diagnostic_fact, reason, possible_consequence,
      used_evidence_card_ids, display_order
    ) VALUES (
      (item->>'findingId')::UUID, item->>'schemaVersion', item->>'policyVersion',
      item->>'contractVersion', item->>'category', item->>'title',
      item->>'diagnosticFact', item->>'reason', NULLIF(item->>'possibleConsequence', ''),
      ARRAY(SELECT jsonb_array_elements_text(item->'usedEvidenceCardIds'))::UUID[],
      (item->>'displayOrder')::INTEGER
    );

    FOR location, location_ordinality IN
      SELECT value, ordinality FROM jsonb_array_elements(item->'relatedLocations') WITH ORDINALITY
    LOOP
      INSERT INTO public.grant_semantic_finding_v3_locations (
        finding_id, location_order, section_id, node_id, role, quote
      ) VALUES (
        (item->>'findingId')::UUID,
        (location_ordinality - 1)::INTEGER,
        (location->>'sectionId')::UUID,
        (location->>'nodeId')::UUID,
        location->>'role',
        NULLIF(location->>'quote', '')
      );
    END LOOP;
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
    'findingId', finding.finding_id,
    'runId', finding.run_id,
    'documentId', finding.document_id,
    'sourceRevisionId', finding.source_revision_id,
    'checkerId', finding.checker_id,
    'checkerVersion', finding.checker_version,
    'contractVersion', run.contract_version,
    'schemaVersion', COALESCE(v3.schema_version, 'grant-finding-v2'),
    'policyVersion', v3.policy_version,
    'fingerprint', finding.fingerprint,
    'category', COALESCE(v3.category, finding.code),
    'title', v3.title,
    'diagnosticFact', COALESCE(v3.diagnostic_fact, finding.message),
    'reason', v3.reason,
    'recommendation', finding.recommendation,
    'possibleConsequence', v3.possible_consequence,
    'assessment', finding.assessment,
    'sourceAnchor', finding.source_anchor,
    'relatedLocations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sectionId', location.section_id,
        'nodeId', location.node_id,
        'role', location.role,
        'quote', location.quote
      ) ORDER BY location.location_order)
      FROM public.grant_semantic_finding_v3_locations AS location
      WHERE location.finding_id = finding.finding_id
    ), '[]'::jsonb),
    'usedEvidenceCardIds', COALESCE(to_jsonb(v3.used_evidence_card_ids), '[]'::jsonb),
    'displayOrder', v3.display_order,
    'lifecycleStatus', finding.lifecycle_status,
    'createdAt', finding.created_at
  ) ORDER BY finding.created_at DESC, v3.display_order NULLS LAST, finding.finding_id), '[]'::jsonb)
  FROM public.grant_findings AS finding
  JOIN public.grant_diagnostic_runs AS run ON run.run_id = finding.run_id
  JOIN public.grant_documents AS document ON document.document_id = finding.document_id
  LEFT JOIN public.grant_semantic_finding_v3_contents AS v3 ON v3.finding_id = finding.finding_id
  WHERE finding.document_id = p_document_id AND document.owner_id = p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.save_grant_semantic_v3_execution(UUID, UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_normalized_findings(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_grant_semantic_v3_execution(UUID, UUID, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_normalized_findings(UUID, UUID) TO service_role;

COMMENT ON TABLE public.grant_semantic_finding_v3_contents IS
  'Additive semantic V3 content attached to the existing program-owned Finding envelope.';
COMMENT ON FUNCTION public.list_grant_normalized_findings(UUID, UUID) IS
  'Single V2/V3 normalized diagnostic projection below the UI boundary.';
