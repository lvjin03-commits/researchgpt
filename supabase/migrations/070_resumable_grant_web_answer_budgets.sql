-- Durable, owner-scoped user budgets for resumable Grant web answers.
-- No runtime is switched by this migration; service-role RPCs are the only API.

CREATE TABLE public.grant_web_answer_budgets (
  budget_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL REFERENCES public.grant_documents(document_id) ON DELETE CASCADE,
  turn_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','awaiting_budget','delivering_existing_results','delivered_complete','delivered_partial','failed_no_delivery','expired')),
  authorized_points BIGINT NOT NULL CHECK (authorized_points > 0),
  settled_points BIGINT NOT NULL DEFAULT 0 CHECK (settled_points >= 0 AND settled_points <= authorized_points),
  state_version BIGINT NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  checkpoint JSONB CHECK (checkpoint IS NULL OR jsonb_typeof(checkpoint) = 'object'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(document_id, turn_id),
  CHECK ((state->>'budgetId')::UUID = budget_id),
  CHECK ((state->>'ownerId')::UUID = owner_id),
  CHECK ((state->>'documentId')::UUID = document_id),
  CHECK ((state->>'turnId')::UUID = turn_id),
  CHECK ((state->>'version')::BIGINT = state_version),
  CHECK ((state->>'authorizedPoints')::BIGINT = authorized_points),
  CHECK ((state->>'settledPoints')::BIGINT = settled_points),
  CHECK (state->>'status' = status)
);

CREATE TABLE public.grant_web_answer_budget_authorizations (
  authorization_id UUID PRIMARY KEY,
  budget_id UUID NOT NULL REFERENCES public.grant_web_answer_budgets(budget_id) ON DELETE RESTRICT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  authorized_points BIGINT NOT NULL CHECK (authorized_points > 0),
  kind TEXT NOT NULL CHECK (kind IN ('initial','increase')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(budget_id, authorization_id)
);

CREATE INDEX grant_web_answer_budgets_owner_status_idx
  ON public.grant_web_answer_budgets(owner_id,status,updated_at DESC);
ALTER TABLE public.grant_web_answer_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grant_web_answer_budget_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.grant_web_answer_budgets,public.grant_web_answer_budget_authorizations FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_grant_web_answer_budget(p_owner_id UUID,p_budget_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN budget_id IS NULL THEN NULL ELSE jsonb_build_object('state',state,'checkpoint',checkpoint) END
  FROM public.grant_web_answer_budgets WHERE budget_id=p_budget_id AND owner_id=p_owner_id;
$$;

CREATE FUNCTION public.create_grant_web_answer_budget(
  p_owner_id UUID,p_state JSONB,p_checkpoint JSONB,p_expires_at TIMESTAMPTZ,p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_budget public.grant_web_answer_budgets; v_auth JSONB;
BEGIN
  IF (p_state->>'version')::BIGINT<>0 OR p_state->>'status'<>'running' OR p_expires_at<=p_now
    THEN RAISE EXCEPTION 'grant_web_budget_initial_state_invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.grant_documents WHERE document_id=(p_state->>'documentId')::UUID AND owner_id=p_owner_id)
    THEN RAISE EXCEPTION 'grant_document_not_found'; END IF;
  IF (p_state->>'ownerId')::UUID<>p_owner_id OR jsonb_array_length(p_state->'authorizations')<>1
    THEN RAISE EXCEPTION 'grant_web_budget_scope_invalid'; END IF;
  IF (p_checkpoint->>'documentId')::UUID<>(p_state->>'documentId')::UUID
    OR (p_checkpoint->>'turnId')::UUID<>(p_state->>'turnId')::UUID
    THEN RAISE EXCEPTION 'grant_web_checkpoint_scope_invalid'; END IF;
  v_auth:=p_state->'authorizations'->0;
  INSERT INTO public.grant_web_answer_budgets VALUES(
    (p_state->>'budgetId')::UUID,p_owner_id,(p_state->>'documentId')::UUID,(p_state->>'turnId')::UUID,
    p_state->>'status',(p_state->>'authorizedPoints')::BIGINT,(p_state->>'settledPoints')::BIGINT,
    0,p_state,p_checkpoint,p_expires_at,p_now,p_now) RETURNING * INTO v_budget;
  INSERT INTO public.grant_web_answer_budget_authorizations
    (authorization_id,budget_id,owner_id,authorized_points,kind,created_at)
  VALUES((v_auth->>'authorizationId')::UUID,v_budget.budget_id,p_owner_id,
    (v_auth->>'authorizedPoints')::BIGINT,'initial',p_now);
  RETURN v_budget.state;
END; $$;

CREATE FUNCTION public.authorize_grant_web_answer_budget_increase(
  p_owner_id UUID,p_budget_id UUID,p_expected_version BIGINT,p_authorization_id UUID,
  p_additional_points BIGINT,p_next_state JSONB,p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_budget public.grant_web_answer_budgets; v_existing BIGINT;
BEGIN
  IF p_additional_points<=0 THEN RAISE EXCEPTION 'invalid_point_authorization'; END IF;
  SELECT * INTO v_budget FROM public.grant_web_answer_budgets
    WHERE budget_id=p_budget_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_web_budget_not_found'; END IF;
  SELECT authorized_points INTO v_existing FROM public.grant_web_answer_budget_authorizations
    WHERE authorization_id=p_authorization_id AND budget_id=p_budget_id;
  IF FOUND THEN
    IF v_existing<>p_additional_points THEN RAISE EXCEPTION 'grant_web_budget_authorization_conflict'; END IF;
    RETURN v_budget.state;
  END IF;
  IF v_budget.state_version<>p_expected_version OR v_budget.status<>'awaiting_budget'
    THEN RAISE EXCEPTION 'grant_web_budget_conflict'; END IF;
  IF (p_next_state->>'version')::BIGINT<>p_expected_version+1
    OR (p_next_state->>'authorizedPoints')::BIGINT<>v_budget.authorized_points+p_additional_points
    OR p_next_state->>'status'<>'running'
    OR jsonb_array_length(p_next_state->'authorizations') <>
      (SELECT COUNT(*)+1 FROM public.grant_web_answer_budget_authorizations WHERE budget_id=p_budget_id)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_next_state->'authorizations') item
      WHERE (item->>'authorizationId')::UUID=p_authorization_id
        AND (item->>'authorizedPoints')::BIGINT=p_additional_points)
    OR EXISTS(SELECT 1 FROM public.grant_web_answer_budget_authorizations existing_authorization
      WHERE existing_authorization.budget_id=p_budget_id AND NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_next_state->'authorizations') item
        WHERE (item->>'authorizationId')::UUID=existing_authorization.authorization_id
          AND (item->>'authorizedPoints')::BIGINT=existing_authorization.authorized_points))
    THEN RAISE EXCEPTION 'grant_web_budget_transition_invalid'; END IF;
  INSERT INTO public.grant_web_answer_budget_authorizations VALUES(
    p_authorization_id,p_budget_id,p_owner_id,p_additional_points,'increase',p_now);
  UPDATE public.grant_web_answer_budgets SET authorized_points=(p_next_state->>'authorizedPoints')::BIGINT,
    status='running',state_version=p_expected_version+1,state=p_next_state,updated_at=p_now
    WHERE budget_id=p_budget_id RETURNING * INTO v_budget;
  RETURN v_budget.state;
END; $$;

CREATE FUNCTION public.transition_grant_web_answer_budget(
  p_owner_id UUID,p_budget_id UUID,p_expected_version BIGINT,p_next_state JSONB,p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_budget public.grant_web_answer_budgets;
BEGIN
  SELECT * INTO v_budget FROM public.grant_web_answer_budgets
    WHERE budget_id=p_budget_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_web_budget_not_found'; END IF;
  IF v_budget.state_version<>p_expected_version THEN RAISE EXCEPTION 'grant_web_budget_conflict'; END IF;
  IF (p_next_state->>'version')::BIGINT<>p_expected_version+1
    OR (p_next_state->>'authorizedPoints')::BIGINT<>v_budget.authorized_points
    OR (p_next_state->>'settledPoints')::BIGINT<>v_budget.settled_points
    OR p_next_state->'activePhase'<>'null'::JSONB
    THEN RAISE EXCEPTION 'grant_web_budget_transition_invalid'; END IF;
  UPDATE public.grant_web_answer_budgets SET status=p_next_state->>'status',
    state_version=p_expected_version+1,state=p_next_state,updated_at=p_now
    WHERE budget_id=p_budget_id RETURNING * INTO v_budget;
  RETURN v_budget.state;
END; $$;

CREATE FUNCTION public.reserve_grant_web_answer_phase(
  p_owner_id UUID,p_budget_id UUID,p_expected_version BIGINT,p_phase_id UUID,
  p_maximum_charge_points BIGINT,p_price_policy_version TEXT,p_expires_at TIMESTAMPTZ,
  p_next_state JSONB,p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_budget public.grant_web_answer_budgets;
BEGIN
  SELECT * INTO v_budget FROM public.grant_web_answer_budgets
    WHERE budget_id=p_budget_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_web_budget_not_found'; END IF;
  IF v_budget.state_version<>p_expected_version THEN RAISE EXCEPTION 'grant_web_budget_conflict'; END IF;
  IF p_maximum_charge_points<=0 OR (p_next_state->>'version')::BIGINT<>p_expected_version+1
    OR p_next_state#>>'{activePhase,phaseId}'<>p_phase_id::TEXT
    OR (p_next_state#>>'{activePhase,maximumChargePoints}')::BIGINT<>p_maximum_charge_points
    OR p_next_state#>>'{activePhase,pricePolicyVersion}'<>p_price_policy_version
    THEN RAISE EXCEPTION 'grant_web_budget_transition_invalid'; END IF;
  PERFORM public.reserve_points(p_owner_id,p_phase_id,p_phase_id,p_maximum_charge_points,
    p_price_policy_version,p_expires_at,p_now);
  UPDATE public.grant_web_answer_budgets SET status=p_next_state->>'status',
    state_version=p_expected_version+1,state=p_next_state,updated_at=p_now
    WHERE budget_id=p_budget_id RETURNING * INTO v_budget;
  RETURN v_budget.state;
END; $$;

CREATE FUNCTION public.settle_grant_web_answer_phase(
  p_owner_id UUID,p_budget_id UUID,p_expected_version BIGINT,p_phase_id UUID,
  p_settled_points BIGINT,p_next_state JSONB,p_checkpoint JSONB,p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_budget public.grant_web_answer_budgets;
BEGIN
  SELECT * INTO v_budget FROM public.grant_web_answer_budgets
    WHERE budget_id=p_budget_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_web_budget_not_found'; END IF;
  IF v_budget.state_version<>p_expected_version OR v_budget.state#>>'{activePhase,phaseId}'<>p_phase_id::TEXT
    THEN RAISE EXCEPTION 'grant_web_budget_conflict'; END IF;
  IF (p_next_state->>'version')::BIGINT<>p_expected_version+1
    OR (p_next_state->>'settledPoints')::BIGINT<>v_budget.settled_points+p_settled_points
    OR p_next_state->'activePhase'<>'null'::JSONB
    THEN RAISE EXCEPTION 'grant_web_budget_transition_invalid'; END IF;
  IF p_checkpoint IS NOT NULL AND ((p_checkpoint->>'documentId')::UUID<>v_budget.document_id
    OR (p_checkpoint->>'turnId')::UUID<>v_budget.turn_id)
    THEN RAISE EXCEPTION 'grant_web_checkpoint_scope_invalid'; END IF;
  PERFORM public.settle_point_reservation(p_owner_id,p_phase_id,p_phase_id,p_settled_points,'grant_web_answer_phase',p_now);
  UPDATE public.grant_web_answer_budgets SET status=p_next_state->>'status',
    settled_points=(p_next_state->>'settledPoints')::BIGINT,state_version=p_expected_version+1,
    state=p_next_state,checkpoint=COALESCE(p_checkpoint,checkpoint),updated_at=p_now
    WHERE budget_id=p_budget_id RETURNING * INTO v_budget;
  RETURN v_budget.state;
END; $$;

CREATE FUNCTION public.release_grant_web_answer_phase(
  p_owner_id UUID,p_budget_id UUID,p_expected_version BIGINT,p_phase_id UUID,
  p_next_state JSONB,p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_budget public.grant_web_answer_budgets;
BEGIN
  SELECT * INTO v_budget FROM public.grant_web_answer_budgets
    WHERE budget_id=p_budget_id AND owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'grant_web_budget_not_found'; END IF;
  IF v_budget.state_version<>p_expected_version OR v_budget.state#>>'{activePhase,phaseId}'<>p_phase_id::TEXT
    THEN RAISE EXCEPTION 'grant_web_budget_conflict'; END IF;
  IF (p_next_state->>'version')::BIGINT<>p_expected_version+1 OR p_next_state->'activePhase'<>'null'::JSONB
    THEN RAISE EXCEPTION 'grant_web_budget_transition_invalid'; END IF;
  PERFORM public.release_point_reservation(p_owner_id,p_phase_id,p_phase_id,'grant_web_answer_phase_failed',p_now);
  UPDATE public.grant_web_answer_budgets SET status=p_next_state->>'status',
    state_version=p_expected_version+1,state=p_next_state,updated_at=p_now
    WHERE budget_id=p_budget_id RETURNING * INTO v_budget;
  RETURN v_budget.state;
END; $$;

REVOKE ALL ON FUNCTION public.create_grant_web_answer_budget(UUID,JSONB,JSONB,TIMESTAMPTZ,TIMESTAMPTZ),
  public.get_grant_web_answer_budget(UUID,UUID),
  public.authorize_grant_web_answer_budget_increase(UUID,UUID,BIGINT,UUID,BIGINT,JSONB,TIMESTAMPTZ),
  public.transition_grant_web_answer_budget(UUID,UUID,BIGINT,JSONB,TIMESTAMPTZ),
  public.reserve_grant_web_answer_phase(UUID,UUID,BIGINT,UUID,BIGINT,TEXT,TIMESTAMPTZ,JSONB,TIMESTAMPTZ),
  public.settle_grant_web_answer_phase(UUID,UUID,BIGINT,UUID,BIGINT,JSONB,JSONB,TIMESTAMPTZ),
  public.release_grant_web_answer_phase(UUID,UUID,BIGINT,UUID,JSONB,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_grant_web_answer_budget(UUID,JSONB,JSONB,TIMESTAMPTZ,TIMESTAMPTZ),
  public.get_grant_web_answer_budget(UUID,UUID),
  public.authorize_grant_web_answer_budget_increase(UUID,UUID,BIGINT,UUID,BIGINT,JSONB,TIMESTAMPTZ),
  public.transition_grant_web_answer_budget(UUID,UUID,BIGINT,JSONB,TIMESTAMPTZ),
  public.reserve_grant_web_answer_phase(UUID,UUID,BIGINT,UUID,BIGINT,TEXT,TIMESTAMPTZ,JSONB,TIMESTAMPTZ),
  public.settle_grant_web_answer_phase(UUID,UUID,BIGINT,UUID,BIGINT,JSONB,JSONB,TIMESTAMPTZ),
  public.release_grant_web_answer_phase(UUID,UUID,BIGINT,UUID,JSONB,TIMESTAMPTZ) TO service_role;
