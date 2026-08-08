-- PR3: immutable checker runs, Findings and explicit checker conflicts.
-- Additive and isolated from chat, Document V2 and canonical revision writes.

CREATE TABLE IF NOT EXISTS public.grant_diagnostic_runs (
  run_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id),
  checker_id TEXT NOT NULL CHECK (length(trim(checker_id)) > 0),
  checker_version TEXT NOT NULL CHECK (length(trim(checker_version)) > 0),
  contract_version TEXT NOT NULL CHECK (length(trim(contract_version)) > 0),
  input_mode TEXT NOT NULL CHECK (input_mode IN ('full_document', 'section_bundle', 'focused_excerpt')),
  input_node_ids UUID[] NOT NULL,
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  parsed_output JSONB NOT NULL CHECK (jsonb_typeof(parsed_output) = 'object'),
  failure_code TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS public.grant_findings (
  finding_id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.grant_diagnostic_runs(run_id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id),
  checker_id TEXT NOT NULL,
  checker_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  code TEXT NOT NULL CHECK (length(trim(code)) > 0),
  message TEXT NOT NULL CHECK (length(trim(message)) > 0),
  recommendation TEXT NOT NULL CHECK (length(trim(recommendation)) > 0),
  assessment JSONB NOT NULL CHECK (jsonb_typeof(assessment) = 'object'),
  source_anchor JSONB NOT NULL CHECK (jsonb_typeof(source_anchor) = 'object'),
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('open', 'closed', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (run_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS public.grant_diagnostic_conflicts (
  conflict_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  source_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id),
  subject_fingerprint TEXT NOT NULL CHECK (subject_fingerprint ~ '^[a-f0-9]{64}$'),
  finding_ids UUID[] NOT NULL CHECK (cardinality(finding_ids) >= 2),
  conflict_kind TEXT NOT NULL CHECK (conflict_kind = 'checker_disagreement'),
  details JSONB NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS grant_diagnostic_runs_document_started_idx
  ON public.grant_diagnostic_runs (document_id, started_at DESC);
CREATE INDEX IF NOT EXISTS grant_findings_document_created_idx
  ON public.grant_findings (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS grant_findings_source_revision_idx
  ON public.grant_findings (source_revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS grant_diagnostic_conflicts_document_created_idx
  ON public.grant_diagnostic_conflicts (document_id, created_at DESC);

ALTER TABLE public.grant_diagnostic_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_diagnostic_conflicts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.grant_diagnostic_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_findings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.grant_diagnostic_conflicts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_diagnostic_runs TO service_role;
GRANT SELECT ON TABLE public.grant_findings TO service_role;
GRANT SELECT ON TABLE public.grant_diagnostic_conflicts TO service_role;

CREATE OR REPLACE FUNCTION public.save_grant_diagnostic_execution(
  p_owner_id UUID,
  p_document_id UUID,
  p_runs JSONB,
  p_findings JSONB,
  p_conflicts JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.grant_documents
    WHERE document_id = p_document_id AND owner_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'grant document not found';
  END IF;
  IF jsonb_typeof(p_runs) <> 'array' OR jsonb_array_length(p_runs) = 0 THEN
    RAISE EXCEPTION 'diagnostic execution requires checker runs';
  END IF;
  IF jsonb_typeof(p_findings) <> 'array' OR jsonb_typeof(p_conflicts) <> 'array' THEN
    RAISE EXCEPTION 'diagnostic Findings and conflicts must be arrays';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_runs) LOOP
    IF (item->>'documentId')::UUID IS DISTINCT FROM p_document_id OR NOT EXISTS (
      SELECT 1 FROM public.grant_document_revisions
      WHERE revision_id = (item->>'sourceRevisionId')::UUID AND document_id = p_document_id
    ) THEN
      RAISE EXCEPTION 'diagnostic run revision mismatch';
    END IF;
    INSERT INTO public.grant_diagnostic_runs (
      run_id, document_id, source_revision_id, checker_id, checker_version,
      contract_version, input_mode, input_node_ids, input_hash, status,
      parsed_output, failure_code, created_by, started_at, completed_at
    ) VALUES (
      (item->>'runId')::UUID, p_document_id, (item->>'sourceRevisionId')::UUID,
      item->>'checkerId', item->>'checkerVersion', item->>'contractVersion',
      item->>'inputMode', ARRAY(SELECT jsonb_array_elements_text(item->'inputNodeIds'))::UUID[],
      item->>'inputHash', item->>'status', item->'parsedOutput',
      NULLIF(item->>'failureCode', ''), (item->>'createdBy')::UUID,
      (item->>'startedAt')::TIMESTAMPTZ, (item->>'completedAt')::TIMESTAMPTZ
    );
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_findings) LOOP
    IF (item->>'documentId')::UUID IS DISTINCT FROM p_document_id OR NOT EXISTS (
      SELECT 1 FROM public.grant_diagnostic_runs
      WHERE run_id = (item->>'runId')::UUID AND document_id = p_document_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.grant_document_revisions
      WHERE revision_id = (item->>'sourceRevisionId')::UUID AND document_id = p_document_id
    ) THEN
      RAISE EXCEPTION 'Finding document mismatch';
    END IF;
    INSERT INTO public.grant_findings (
      finding_id, run_id, document_id, source_revision_id, checker_id,
      checker_version, fingerprint, code, message, recommendation, assessment,
      source_anchor, lifecycle_status, created_at
    ) VALUES (
      (item->>'findingId')::UUID, (item->>'runId')::UUID, p_document_id,
      (item->>'sourceRevisionId')::UUID, item->>'checkerId', item->>'checkerVersion',
      item->>'fingerprint', item->>'code', item->>'message', item->>'recommendation',
      item->'assessment', item->'sourceAnchor', item->>'lifecycleStatus',
      (item->>'createdAt')::TIMESTAMPTZ
    );
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_conflicts) LOOP
    IF (item->>'documentId')::UUID IS DISTINCT FROM p_document_id OR NOT EXISTS (
      SELECT 1 FROM public.grant_document_revisions
      WHERE revision_id = (item->>'sourceRevisionId')::UUID AND document_id = p_document_id
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(item->'findingIds') AS requested(finding_id)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.grant_findings
        WHERE grant_findings.finding_id = requested.finding_id::UUID
          AND grant_findings.document_id = p_document_id
      )
    ) THEN
      RAISE EXCEPTION 'diagnostic conflict document mismatch';
    END IF;
    INSERT INTO public.grant_diagnostic_conflicts (
      conflict_id, document_id, source_revision_id, subject_fingerprint,
      finding_ids, conflict_kind, details, created_at
    ) VALUES (
      (item->>'conflictId')::UUID, p_document_id, (item->>'sourceRevisionId')::UUID,
      item->>'subjectFingerprint', ARRAY(SELECT jsonb_array_elements_text(item->'findingIds'))::UUID[],
      item->>'conflictKind', item->'details', (item->>'createdAt')::TIMESTAMPTZ
    );
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_findings(p_owner_id UUID, p_document_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'findingId', finding.finding_id, 'runId', finding.run_id,
    'documentId', finding.document_id, 'sourceRevisionId', finding.source_revision_id,
    'checkerId', finding.checker_id, 'checkerVersion', finding.checker_version,
    'fingerprint', finding.fingerprint, 'code', finding.code,
    'message', finding.message, 'recommendation', finding.recommendation,
    'assessment', finding.assessment, 'sourceAnchor', finding.source_anchor,
    'lifecycleStatus', finding.lifecycle_status, 'createdAt', finding.created_at
  ) ORDER BY finding.created_at DESC, finding.finding_id), '[]'::jsonb)
  FROM public.grant_findings AS finding
  JOIN public.grant_documents AS document ON document.document_id = finding.document_id
  WHERE finding.document_id = p_document_id AND document.owner_id = p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_diagnostic_conflicts(p_owner_id UUID, p_document_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'conflictId', conflict.conflict_id, 'documentId', conflict.document_id,
    'sourceRevisionId', conflict.source_revision_id,
    'subjectFingerprint', conflict.subject_fingerprint,
    'findingIds', conflict.finding_ids, 'conflictKind', conflict.conflict_kind,
    'details', conflict.details, 'createdAt', conflict.created_at
  ) ORDER BY conflict.created_at DESC, conflict.conflict_id), '[]'::jsonb)
  FROM public.grant_diagnostic_conflicts AS conflict
  JOIN public.grant_documents AS document ON document.document_id = conflict.document_id
  WHERE conflict.document_id = p_document_id AND document.owner_id = p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.save_grant_diagnostic_execution(UUID, UUID, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_findings(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_diagnostic_conflicts(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_grant_diagnostic_execution(UUID, UUID, JSONB, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_findings(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_diagnostic_conflicts(UUID, UUID) TO service_role;

COMMENT ON TABLE public.grant_findings IS
  'Immutable checker conclusions with explicit source anchors; no severity ranking.';
