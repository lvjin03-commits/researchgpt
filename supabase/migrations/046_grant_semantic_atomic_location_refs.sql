-- Atomic model-facing location references advance the semantic provider/run
-- contract to V4 while retaining the existing durable Finding V3 projection.
-- V3 remains accepted during the bounded rollback window.

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
    RAISE EXCEPTION 'semantic diagnostic execution requires one run object and a Finding array';
  END IF;
  IF p_run->>'contractVersion' NOT IN (
    'grant-semantic-diagnostic-v3',
    'grant-semantic-diagnostic-v4'
  ) THEN
    RAISE EXCEPTION 'semantic diagnostic run contract mismatch';
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
      RAISE EXCEPTION 'semantic Finding envelope mismatch';
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

REVOKE ALL ON FUNCTION public.save_grant_semantic_v3_execution(UUID, UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_grant_semantic_v3_execution(UUID, UUID, JSONB, JSONB) TO service_role;

COMMENT ON FUNCTION public.save_grant_semantic_v3_execution(UUID, UUID, JSONB, JSONB) IS
  'Atomic semantic save; accepts V3 for bounded rollback and V4 atomic location-reference runs.';
