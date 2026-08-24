-- Versioned AI price policies and atomic reservation of all Bundle slices.
-- No policy rows are seeded and no production charging path is enabled.

CREATE TABLE public.ai_price_policies (
  policy_version TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX ai_price_policy_lookup_idx
  ON public.ai_price_policies(operation,provider,model_id,effective_from DESC);

ALTER TABLE public.ai_price_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_price_policies FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.put_ai_price_policy(p_policy JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE(p_policy->>'policyVersion','')='' OR COALESCE(p_policy->>'operation','')=''
    OR COALESCE(p_policy->>'provider','')='' OR COALESCE(p_policy->>'modelId','')='' THEN
    RAISE EXCEPTION 'invalid_ai_price_policy';
  END IF;
  INSERT INTO public.ai_price_policies(policy_version,operation,provider,model_id,payload,effective_from,effective_until)
  VALUES(p_policy->>'policyVersion',p_policy->>'operation',p_policy->>'provider',p_policy->>'modelId',p_policy,
    (p_policy->>'effectiveFrom')::TIMESTAMPTZ,(p_policy->>'effectiveUntil')::TIMESTAMPTZ);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'ai_price_policy_is_immutable';
END; $$;

CREATE OR REPLACE FUNCTION public.get_ai_price_policy(
  p_operation TEXT,p_provider TEXT,p_model_id TEXT,p_at TIMESTAMPTZ
) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT policy.payload FROM public.ai_price_policies policy
  WHERE policy.operation=p_operation AND policy.provider=p_provider AND policy.model_id=p_model_id
    AND policy.effective_from<=p_at AND (policy.effective_until IS NULL OR policy.effective_until>p_at)
  ORDER BY policy.effective_from DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_price_policy_by_version(p_policy_version TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT payload FROM public.ai_price_policies WHERE policy_version=p_policy_version;
$$;

CREATE OR REPLACE FUNCTION public.reserve_point_bundle_set(
  p_owner_id UUID,p_parent_billing_operation_id UUID,p_bundles JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account public.point_accounts; v_bundle JSONB; v_results JSONB:='[]'::JSONB;
  v_total BIGINT:=0; v_count INTEGER; v_existing INTEGER; v_result JSONB;
BEGIN
  IF jsonb_typeof(p_bundles)<>'array' OR jsonb_array_length(p_bundles)=0 THEN RAISE EXCEPTION 'invalid_bundle_set'; END IF;
  v_count:=jsonb_array_length(p_bundles);
  SELECT COUNT(*) INTO v_existing FROM public.point_reservations reservation
    JOIN public.point_accounts account ON account.account_id=reservation.account_id
    WHERE account.owner_id=p_owner_id AND reservation.billing_operation_id IN
      (SELECT (item->>'billingOperationId')::UUID FROM jsonb_array_elements(p_bundles) item);
  IF v_existing=v_count THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(reservation) ORDER BY reservation.created_at),'[]'::JSONB) INTO v_results
    FROM public.point_reservations reservation JOIN public.point_accounts account ON account.account_id=reservation.account_id
    WHERE account.owner_id=p_owner_id AND reservation.billing_operation_id IN
      (SELECT (item->>'billingOperationId')::UUID FROM jsonb_array_elements(p_bundles) item);
    RETURN v_results;
  END IF;
  IF v_existing<>0 THEN RAISE EXCEPTION 'partial_bundle_set_conflict'; END IF;
  FOR v_bundle IN SELECT value FROM jsonb_array_elements(p_bundles) LOOP
    IF (v_bundle->>'points')::BIGINT<=0 THEN RAISE EXCEPTION 'invalid_bundle_points'; END IF;
    v_total:=v_total+(v_bundle->>'points')::BIGINT;
  END LOOP;
  SELECT * INTO v_account FROM public.point_accounts WHERE owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND OR v_account.available_points<v_total THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  IF v_account.status<>'active' THEN RAISE EXCEPTION 'point_account_on_hold'; END IF;
  -- Recheck after serialization to close the pre-lock idempotency race.
  SELECT COUNT(*) INTO v_existing FROM public.point_reservations
    WHERE account_id=v_account.account_id AND billing_operation_id IN
      (SELECT (item->>'billingOperationId')::UUID FROM jsonb_array_elements(p_bundles) item);
  IF v_existing=v_count THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(reservation) ORDER BY reservation.created_at),'[]'::JSONB) INTO v_results
      FROM public.point_reservations reservation WHERE reservation.account_id=v_account.account_id
      AND reservation.billing_operation_id IN (SELECT (item->>'billingOperationId')::UUID FROM jsonb_array_elements(p_bundles) item);
    RETURN v_results;
  END IF;
  IF v_existing<>0 THEN RAISE EXCEPTION 'partial_bundle_set_conflict'; END IF;
  FOR v_bundle IN SELECT value FROM jsonb_array_elements(p_bundles) LOOP
    v_result:=public.reserve_points(p_owner_id,(v_bundle->>'reservationId')::UUID,
      (v_bundle->>'billingOperationId')::UUID,(v_bundle->>'points')::BIGINT,
      v_bundle->>'pricePolicyVersion',(v_bundle->>'expiresAt')::TIMESTAMPTZ,
      (v_bundle->>'now')::TIMESTAMPTZ);
    v_results:=v_results||jsonb_build_array(v_result);
  END LOOP;
  RETURN v_results;
END; $$;

REVOKE ALL ON FUNCTION public.put_ai_price_policy(JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_ai_price_policy(TEXT,TEXT,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_ai_price_policy_by_version(TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reserve_point_bundle_set(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.put_ai_price_policy(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_price_policy(TEXT,TEXT,TEXT,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ai_price_policy_by_version(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_point_bundle_set(UUID,UUID,JSONB) TO service_role;
