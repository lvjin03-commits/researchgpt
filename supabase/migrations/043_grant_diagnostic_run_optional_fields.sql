-- Preserve the GrantDiagnosticRun optional-field contract for historical
-- successful runs. PostgreSQL stores failure_code as NULL, while the API
-- contract represents absence by omitting failureCode rather than emitting
-- JSON null.

CREATE OR REPLACE FUNCTION public.list_grant_diagnostic_runs(
  p_owner_id UUID,
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'runId', run.run_id,
    'documentId', run.document_id,
    'sourceRevisionId', run.source_revision_id,
    'checkerId', run.checker_id,
    'checkerVersion', run.checker_version,
    'contractVersion', run.contract_version,
    'inputMode', run.input_mode,
    'inputNodeIds', run.input_node_ids,
    'inputHash', run.input_hash,
    'status', run.status,
    'parsedOutput', run.parsed_output,
    'failureCode', run.failure_code,
    'createdBy', run.created_by,
    'startedAt', run.started_at,
    'completedAt', run.completed_at
  )) ORDER BY run.completed_at DESC, run.run_id), '[]'::jsonb)
  FROM public.grant_diagnostic_runs AS run
  JOIN public.grant_documents AS document ON document.document_id = run.document_id
  WHERE run.document_id = p_document_id AND document.owner_id = p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.list_grant_diagnostic_runs(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_grant_diagnostic_runs(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.list_grant_diagnostic_runs(UUID, UUID) IS
  'Owner-scoped immutable run history; optional fields are omitted when absent.';
