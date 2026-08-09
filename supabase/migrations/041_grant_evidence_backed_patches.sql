-- PR7: atomically persist and accept evidence-backed Patch proposals.

CREATE OR REPLACE FUNCTION public.assert_current_grant_patch_evidence(
  p_document_id UUID,
  p_proposal JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal_id UUID := (p_proposal->>'proposalId')::UUID;
  v_binding JSONB;
  v_source_id UUID;
  v_authorization JSONB;
BEGIN
  IF jsonb_typeof(p_proposal->'evidenceBindings') <> 'array'
     OR jsonb_array_length(p_proposal->'evidenceBindings') = 0 THEN
    RAISE EXCEPTION 'evidence-backed proposal requires evidence bindings';
  END IF;
  FOR v_binding IN SELECT value FROM jsonb_array_elements(p_proposal->'evidenceBindings') LOOP
    v_source_id := (v_binding->>'sourceId')::UUID;
    SELECT auth.authorization_state INTO v_authorization
    FROM public.grant_evidence_authorizations AS auth
    JOIN public.grant_evidence_sources AS source ON source.source_id = auth.source_id
    WHERE auth.document_id = p_document_id
      AND auth.source_id = v_source_id
      AND auth.revision = (v_binding->>'authorizationRevision')::INTEGER
      AND source.status = 'active'
      AND source.source->>'contentHash' = v_binding->>'sourceContentHash';
    IF v_authorization IS NULL
       OR v_authorization ? 'revokedAt'
       OR (v_authorization ? 'expiresAt' AND (v_authorization->>'expiresAt')::TIMESTAMPTZ <= now())
       OR (v_authorization ? 'allowedTaskIds' AND NOT (v_authorization->'allowedTaskIds' ? v_proposal_id::TEXT))
       OR COALESCE((v_authorization#>>'{permissions,sendRelevantExcerptToModel}')::BOOLEAN, false) IS NOT TRUE
       OR COALESCE((v_authorization#>>'{permissions,useForReasoning}')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'current evidence authorization does not permit this proposal';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.grant_evidence_cards AS card
      WHERE card.card_id = (v_binding->>'cardId')::UUID
        AND card.source_id = v_source_id
        AND card.document_id = p_document_id
        AND card.card->>'status' = 'active'
        AND card.card->>'excerptHash' = v_binding->>'excerptHash'
    ) THEN
      RAISE EXCEPTION 'evidence card binding is stale';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_grant_evidence_backed_patch_proposal(
  p_owner_id UUID,
  p_proposal JSONB,
  p_dependencies JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_document_id UUID := (p_proposal->>'documentId')::UUID;
  v_proposal_id UUID := (p_proposal->>'proposalId')::UUID;
  v_dependency JSONB;
  v_source_id UUID;
BEGIN
  IF jsonb_typeof(p_proposal->'evidenceBindings') <> 'array'
     OR jsonb_array_length(p_proposal->'evidenceBindings') = 0 THEN
    RAISE EXCEPTION 'evidence-backed proposal requires evidence bindings';
  END IF;
  IF jsonb_typeof(p_dependencies) <> 'array' THEN
    RAISE EXCEPTION 'evidence dependencies must be an array';
  END IF;
  IF (
    SELECT COUNT(DISTINCT binding->>'sourceId')
    FROM jsonb_array_elements(p_proposal->'evidenceBindings') AS binding
  ) <> jsonb_array_length(p_dependencies) THEN
    RAISE EXCEPTION 'evidence dependency coverage mismatch';
  END IF;

  PERFORM public.assert_current_grant_patch_evidence(v_document_id, p_proposal);

  PERFORM public.create_grant_patch_proposal(p_owner_id, p_proposal);

  FOR v_dependency IN SELECT value FROM jsonb_array_elements(p_dependencies) LOOP
    v_source_id := (v_dependency->>'sourceId')::UUID;
    IF v_dependency->>'documentId' <> v_document_id::TEXT
       OR v_dependency->>'dependentId' <> v_proposal_id::TEXT
       OR v_dependency->>'dependentKind' <> 'patch_proposal'
       OR v_dependency->>'status' <> 'active'
       OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_proposal->'evidenceBindings') AS binding
         WHERE binding->>'sourceId' = v_source_id::TEXT
       ) THEN
      RAISE EXCEPTION 'invalid evidence dependency';
    END IF;
    INSERT INTO public.grant_evidence_dependencies(
      dependency_id, document_id, source_id, dependent_kind, dependent_id,
      status, dependency, created_at, updated_at
    ) VALUES (
      (v_dependency->>'dependencyId')::UUID, v_document_id, v_source_id,
      'patch_proposal', v_proposal_id, 'active', v_dependency,
      (v_dependency->>'createdAt')::TIMESTAMPTZ,
      (v_dependency->>'updatedAt')::TIMESTAMPTZ
    );
  END LOOP;
  RETURN p_proposal;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_grant_evidence_patch_revision(
  p_owner_id UUID,
  p_document_id UUID,
  p_expected_revision_id UUID,
  p_revision_id UUID,
  p_content_hash TEXT,
  p_snapshot JSONB,
  p_actor_id UUID,
  p_actor_kind TEXT,
  p_audit_event_id UUID,
  p_audit_metadata JSONB,
  p_proposal_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal public.grant_patch_proposals;
  v_committed BOOLEAN;
  v_committed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  SELECT proposal.* INTO v_proposal
  FROM public.grant_patch_proposals AS proposal
  JOIN public.grant_documents AS document ON document.document_id = proposal.document_id
  WHERE proposal.proposal_id = p_proposal_id
    AND proposal.document_id = p_document_id
    AND document.owner_id = p_owner_id
  FOR UPDATE OF proposal;

  IF NOT FOUND OR v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'evidence-backed patch proposal is not pending';
  END IF;
  IF v_proposal.base_revision_id IS DISTINCT FROM p_expected_revision_id THEN
    RAISE EXCEPTION 'evidence-backed patch base revision mismatch';
  END IF;

  PERFORM public.assert_current_grant_patch_evidence(p_document_id, v_proposal.proposal);
  v_committed := public.commit_grant_document_revision(
    p_owner_id, p_document_id, p_expected_revision_id, p_revision_id,
    p_content_hash, p_snapshot, p_actor_id, p_actor_kind,
    p_audit_event_id, p_audit_metadata
  );
  IF v_committed IS NOT TRUE THEN
    RETURN FALSE;
  END IF;

  UPDATE public.grant_patch_proposals
  SET status = 'accepted',
      updated_at = v_committed_at,
      proposal = jsonb_set(
        jsonb_set(proposal, '{status}', to_jsonb('accepted'::TEXT), false),
        '{acceptedRevisionId}', to_jsonb(p_revision_id::TEXT), true
      ) || jsonb_build_object('updatedAt', v_committed_at)
  WHERE proposal_id = p_proposal_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence-backed patch acceptance lost ownership';
  END IF;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_current_grant_patch_evidence(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_grant_evidence_patch_revision(
  UUID, UUID, UUID, UUID, TEXT, JSONB, UUID, TEXT, UUID, JSONB, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_grant_evidence_patch_revision(
  UUID, UUID, UUID, UUID, TEXT, JSONB, UUID, TEXT, UUID, JSONB, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.create_grant_evidence_backed_patch_proposal(UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_grant_evidence_backed_patch_proposal(UUID, JSONB, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.create_grant_evidence_backed_patch_proposal(UUID, JSONB, JSONB) IS
  'PR7 transaction: current evidence guard, immutable Patch proposal and revocation dependencies.';

COMMENT ON FUNCTION public.commit_grant_evidence_patch_revision(
  UUID, UUID, UUID, UUID, TEXT, JSONB, UUID, TEXT, UUID, JSONB, UUID
) IS 'PR7 transaction: current evidence guard, revision CAS and Patch acceptance.';
