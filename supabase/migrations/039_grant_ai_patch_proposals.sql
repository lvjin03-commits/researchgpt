-- PR5: evidence-free AI proposals. Canonical writes still go through Revision Service.

CREATE TABLE IF NOT EXISTS public.grant_patch_proposals (
  proposal_id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  base_revision_id UUID NOT NULL REFERENCES public.grant_document_revisions(revision_id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'invalidated')),
  proposal JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS grant_patch_proposals_document_created_idx
  ON public.grant_patch_proposals (document_id, created_at DESC);

ALTER TABLE public.grant_patch_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.grant_patch_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.grant_patch_proposals TO service_role;

CREATE OR REPLACE FUNCTION public.create_grant_patch_proposal(
  p_owner_id UUID,
  p_proposal JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_document_id UUID := (p_proposal->>'documentId')::UUID;
  v_proposal_id UUID := (p_proposal->>'proposalId')::UUID;
  v_base_revision_id UUID := (p_proposal->>'baseRevisionId')::UUID;
BEGIN
  IF p_proposal->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'new grant patch proposal must be pending';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.grant_documents
    WHERE document_id = v_document_id AND owner_id = p_owner_id
  ) THEN
    RAISE EXCEPTION 'grant document not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.grant_document_revisions
    WHERE revision_id = v_base_revision_id AND document_id = v_document_id
  ) THEN
    RAISE EXCEPTION 'grant patch base revision not found';
  END IF;

  INSERT INTO public.grant_patch_proposals (
    proposal_id, document_id, base_revision_id, status, proposal, created_at, updated_at
  ) VALUES (
    v_proposal_id,
    v_document_id,
    v_base_revision_id,
    'pending',
    p_proposal,
    (p_proposal->>'createdAt')::TIMESTAMPTZ,
    (p_proposal->>'updatedAt')::TIMESTAMPTZ
  );
  RETURN p_proposal;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_grant_patch_proposal(
  p_owner_id UUID,
  p_document_id UUID,
  p_proposal_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT proposal.proposal
  FROM public.grant_patch_proposals AS proposal
  JOIN public.grant_documents AS document ON document.document_id = proposal.document_id
  WHERE proposal.document_id = p_document_id
    AND proposal.proposal_id = p_proposal_id
    AND document.owner_id = p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.list_grant_patch_proposals(
  p_owner_id UUID,
  p_document_id UUID
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(proposal.proposal ORDER BY proposal.created_at DESC), '[]'::JSONB)
  FROM public.grant_patch_proposals AS proposal
  JOIN public.grant_documents AS document ON document.document_id = proposal.document_id
  WHERE proposal.document_id = p_document_id AND document.owner_id = p_owner_id;
$$;

CREATE OR REPLACE FUNCTION public.set_grant_patch_proposal_status(
  p_owner_id UUID,
  p_document_id UUID,
  p_proposal_id UUID,
  p_expected_status TEXT,
  p_status TEXT,
  p_accepted_revision_id UUID,
  p_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_status NOT IN ('accepted', 'rejected', 'invalidated') THEN
    RAISE EXCEPTION 'invalid grant patch proposal transition';
  END IF;
  IF p_status = 'accepted' AND p_accepted_revision_id IS NULL THEN
    RAISE EXCEPTION 'accepted patch requires revision';
  END IF;
  IF p_accepted_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.grant_document_revisions
    WHERE revision_id = p_accepted_revision_id AND document_id = p_document_id
  ) THEN
    RAISE EXCEPTION 'accepted grant revision not found';
  END IF;

  UPDATE public.grant_patch_proposals AS proposal
  SET status = p_status,
      updated_at = p_updated_at,
      proposal = jsonb_strip_nulls(
        jsonb_set(
          jsonb_set(proposal.proposal, '{status}', to_jsonb(p_status), false),
          '{updatedAt}', to_jsonb(p_updated_at), false
        ) || jsonb_build_object('acceptedRevisionId', p_accepted_revision_id)
      )
  FROM public.grant_documents AS document
  WHERE proposal.proposal_id = p_proposal_id
    AND proposal.document_id = p_document_id
    AND proposal.status = p_expected_status
    AND document.document_id = proposal.document_id
    AND document.owner_id = p_owner_id
  RETURNING proposal.proposal INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'grant patch proposal status changed or proposal not found';
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_grant_patch_proposal(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_grant_patch_proposal(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_grant_patch_proposals(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_grant_patch_proposal_status(UUID, UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_grant_patch_proposal(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_grant_patch_proposal(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_grant_patch_proposals(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_grant_patch_proposal_status(UUID, UUID, UUID, TEXT, TEXT, UUID, TIMESTAMPTZ) TO service_role;

COMMENT ON TABLE public.grant_patch_proposals IS
  'Immutable AI patch content plus lifecycle projection; canonical content remains owned by grant revisions.';
