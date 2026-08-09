-- PR4: user disposition is independent from immutable checker conclusions.

CREATE TABLE IF NOT EXISTS public.grant_finding_feedback (
  finding_id UUID PRIMARY KEY REFERENCES public.grant_findings(finding_id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  disposition TEXT NOT NULL CHECK (disposition IN (
    'none', 'prioritized', 'deferred', 'ignored', 'reported_false_positive'
  )),
  updated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS grant_finding_feedback_document_updated_idx
  ON public.grant_finding_feedback (document_id, updated_at DESC);

ALTER TABLE public.grant_finding_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_finding_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_finding_feedback TO service_role;

CREATE OR REPLACE FUNCTION public.set_grant_finding_feedback(
  p_owner_id UUID,
  p_document_id UUID,
  p_finding_id UUID,
  p_disposition TEXT,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  IF p_actor_id IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'grant feedback actor mismatch';
  END IF;
  IF p_disposition NOT IN (
    'none', 'prioritized', 'deferred', 'ignored', 'reported_false_positive'
  ) THEN
    RAISE EXCEPTION 'invalid grant Finding disposition';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.grant_findings AS finding
    JOIN public.grant_documents AS document ON document.document_id = finding.document_id
    WHERE finding.finding_id = p_finding_id
      AND finding.document_id = p_document_id
      AND document.owner_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'grant Finding not found';
  END IF;

  INSERT INTO public.grant_finding_feedback (
    finding_id, document_id, disposition, updated_by, updated_at
  ) VALUES (
    p_finding_id, p_document_id, p_disposition, p_actor_id, v_updated_at
  )
  ON CONFLICT (finding_id) DO UPDATE SET
    disposition = EXCLUDED.disposition,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'findingId', p_finding_id,
    'documentId', p_document_id,
    'disposition', p_disposition,
    'updatedBy', p_actor_id,
    'updatedAt', v_updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_finding_feedback(
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
    'findingId', feedback.finding_id,
    'documentId', feedback.document_id,
    'disposition', feedback.disposition,
    'updatedBy', feedback.updated_by,
    'updatedAt', feedback.updated_at
  ) ORDER BY feedback.updated_at DESC, feedback.finding_id), '[]'::jsonb)
  FROM public.grant_finding_feedback AS feedback
  JOIN public.grant_documents AS document ON document.document_id = feedback.document_id
  WHERE feedback.document_id = p_document_id AND document.owner_id = p_owner_id;
$$;

REVOKE ALL ON FUNCTION public.set_grant_finding_feedback(UUID, UUID, UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_finding_feedback(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_grant_finding_feedback(UUID, UUID, UUID, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_finding_feedback(UUID, UUID)
  TO service_role;

COMMENT ON TABLE public.grant_finding_feedback IS
  'User disposition only; it never changes or confirms the immutable Finding conclusion.';
