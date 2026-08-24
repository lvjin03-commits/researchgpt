-- Automated provider reversals and privacy-minimized checkout risk controls.

ALTER TABLE public.point_payment_events
  DROP CONSTRAINT IF EXISTS point_payment_events_event_kind_check;
ALTER TABLE public.point_payment_events
  ADD CONSTRAINT point_payment_events_event_kind_check
  CHECK (event_kind IN ('payment_succeeded','payment_reversed','chargeback'));
ALTER TABLE public.point_payment_events
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS recovered_points BIGINT NOT NULL DEFAULT 0 CHECK (recovered_points >= 0),
  ADD COLUMN IF NOT EXISTS shortfall_points BIGINT NOT NULL DEFAULT 0 CHECK (shortfall_points >= 0);
ALTER TABLE public.point_payment_events
  DROP CONSTRAINT IF EXISTS point_payment_events_reversal_reason_check;
ALTER TABLE public.point_payment_events
  ADD CONSTRAINT point_payment_events_reversal_reason_check CHECK (
    (event_kind='payment_succeeded' AND reversal_reason IS NULL)
    OR (event_kind='payment_reversed' AND reversal_reason='forced_reversal')
    OR (event_kind='chargeback' AND reversal_reason='chargeback')
  );

CREATE TABLE IF NOT EXISTS public.point_payment_risk_events (
  risk_event_id UUID PRIMARY KEY,
  order_id UUID NOT NULL UNIQUE,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount_minor_units BIGINT NOT NULL CHECK (amount_minor_units > 0),
  device_hash TEXT NOT NULL CHECK (device_hash ~ '^[a-f0-9]{64}$'),
  network_hash TEXT NOT NULL CHECK (network_hash ~ '^[a-f0-9]{64}$'),
  payment_method_hash TEXT CHECK (payment_method_hash IS NULL OR payment_method_hash ~ '^[a-f0-9]{64}$'),
  decision TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  reason TEXT NOT NULL CHECK (reason IN (
    'within_limits','single_purchase_limit','account_daily_limit',
    'device_daily_limit','network_velocity_limit','payment_method_account_limit'
  )),
  policy_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS point_payment_risk_owner_created_idx
  ON public.point_payment_risk_events(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS point_payment_risk_device_created_idx
  ON public.point_payment_risk_events(device_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS point_payment_risk_network_created_idx
  ON public.point_payment_risk_events(network_hash,created_at DESC);
CREATE INDEX IF NOT EXISTS point_payment_risk_method_created_idx
  ON public.point_payment_risk_events(payment_method_hash,created_at DESC)
  WHERE payment_method_hash IS NOT NULL;
ALTER TABLE public.point_payment_risk_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.point_payment_risk_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.authorize_point_payment_checkout(
  p_risk_event_id UUID, p_order_id UUID, p_owner_id UUID,
  p_amount_minor_units BIGINT, p_device_hash TEXT, p_network_hash TEXT,
  p_payment_method_hash TEXT, p_policy JSONB, p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_reason TEXT := 'within_limits'; v_decision TEXT := 'allow';
  v_total BIGINT; v_count BIGINT;
BEGIN
  IF p_amount_minor_units<=0 OR p_device_hash!~'^[a-f0-9]{64}$'
     OR p_network_hash!~'^[a-f0-9]{64}$'
     OR (p_payment_method_hash IS NOT NULL AND p_payment_method_hash!~'^[a-f0-9]{64}$') THEN
    RAISE EXCEPTION 'invalid_payment_risk_input';
  END IF;
  -- Serialize each dimension in a fixed order to prevent concurrent limit bypass.
  PERFORM pg_advisory_xact_lock(hashtextextended('risk-account:'||p_owner_id::TEXT,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('risk-device:'||p_device_hash,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('risk-network:'||p_network_hash,0));
  IF p_payment_method_hash IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('risk-method:'||p_payment_method_hash,0));
  END IF;

  IF p_amount_minor_units>(p_policy->>'maximumSinglePurchaseMinorUnits')::BIGINT THEN
    v_reason:='single_purchase_limit';
  ELSE
    SELECT COALESCE(SUM(amount_minor_units),0) INTO v_total FROM public.point_payment_risk_events
      WHERE owner_id=p_owner_id AND decision='allow' AND created_at>=p_now-INTERVAL '24 hours';
    IF v_total+p_amount_minor_units>(p_policy->>'maximumAccountDailyMinorUnits')::BIGINT THEN
      v_reason:='account_daily_limit';
    ELSE
      SELECT COALESCE(SUM(amount_minor_units),0) INTO v_total FROM public.point_payment_risk_events
        WHERE device_hash=p_device_hash AND decision='allow' AND created_at>=p_now-INTERVAL '24 hours';
      IF v_total+p_amount_minor_units>(p_policy->>'maximumDeviceDailyMinorUnits')::BIGINT THEN
        v_reason:='device_daily_limit';
      ELSE
        SELECT COUNT(*) INTO v_count FROM public.point_payment_risk_events
          WHERE network_hash=p_network_hash AND created_at>=p_now-INTERVAL '1 hour';
        IF v_count>=(p_policy->>'maximumNetworkHourlyOrders')::BIGINT THEN
          v_reason:='network_velocity_limit';
        ELSIF p_payment_method_hash IS NOT NULL THEN
          SELECT COUNT(DISTINCT owner_id) INTO v_count FROM public.point_payment_risk_events
            WHERE payment_method_hash=p_payment_method_hash AND decision='allow'
              AND created_at>=p_now-INTERVAL '24 hours';
          IF v_count>=(p_policy->>'maximumPaymentMethodDailyAccounts')::BIGINT
             AND NOT EXISTS(SELECT 1 FROM public.point_payment_risk_events
               WHERE payment_method_hash=p_payment_method_hash AND owner_id=p_owner_id
                 AND decision='allow' AND created_at>=p_now-INTERVAL '24 hours') THEN
            v_reason:='payment_method_account_limit';
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  IF v_reason<>'within_limits' THEN v_decision:='deny'; END IF;
  INSERT INTO public.point_payment_risk_events(
    risk_event_id,order_id,owner_id,amount_minor_units,device_hash,network_hash,
    payment_method_hash,decision,reason,policy_version,created_at
  ) VALUES (p_risk_event_id,p_order_id,p_owner_id,p_amount_minor_units,p_device_hash,
    p_network_hash,p_payment_method_hash,v_decision,v_reason,p_policy->>'policyVersion',p_now);
  RETURN jsonb_build_object('riskEventId',p_risk_event_id,'decision',v_decision,
    'reason',v_reason,'policyVersion',p_policy->>'policyVersion');
END $$;

CREATE OR REPLACE FUNCTION public.reverse_point_payment(
  p_provider_event_id TEXT, p_provider TEXT, p_event_kind TEXT,
  p_reversal_reason TEXT, p_merchant_account_id TEXT, p_provider_order_id TEXT,
  p_order_id UUID, p_amount_minor_units BIGINT, p_currency TEXT,
  p_occurred_at TIMESTAMPTZ, p_audit JSONB,
  p_purchased_reversal_event_id UUID, p_bonus_reversal_event_id UUID,
  p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_order public.point_payment_orders; v_existing public.point_payment_events;
  v_lot public.point_lots; v_result JSONB; v_recovered BIGINT:=0; v_shortfall BIGINT:=0;
BEGIN
  IF (p_event_kind='chargeback' AND p_reversal_reason<>'chargeback')
     OR (p_event_kind='payment_reversed' AND p_reversal_reason<>'forced_reversal') THEN
    RAISE EXCEPTION 'payment_reversal_reason_mismatch';
  END IF;
  SELECT * INTO v_existing FROM public.point_payment_events
    WHERE provider=p_provider AND provider_event_id=p_provider_event_id;
  IF FOUND THEN
    IF v_existing.order_id<>p_order_id THEN RAISE EXCEPTION 'provider_event_conflict'; END IF;
    SELECT * INTO v_order FROM public.point_payment_orders WHERE order_id=p_order_id;
    RETURN jsonb_build_object('order',public.point_payment_order_json(v_order),
      'account',public.point_account_snapshot(v_order.owner_id),
      'recoveredPoints',v_existing.recovered_points,'shortfallPoints',v_existing.shortfall_points);
  END IF;

  SELECT * INTO v_order FROM public.point_payment_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_order_not_found'; END IF;
  SELECT * INTO v_existing FROM public.point_payment_events
    WHERE provider=p_provider AND provider_event_id=p_provider_event_id;
  IF FOUND THEN
    IF v_existing.order_id<>p_order_id THEN RAISE EXCEPTION 'provider_event_conflict'; END IF;
    RETURN jsonb_build_object('order',public.point_payment_order_json(v_order),
      'account',public.point_account_snapshot(v_order.owner_id),
      'recoveredPoints',v_existing.recovered_points,'shortfallPoints',v_existing.shortfall_points);
  END IF;
  IF v_order.provider<>p_provider OR v_order.merchant_account_id<>p_merchant_account_id
     OR v_order.provider_order_id<>p_provider_order_id
     OR v_order.amount_minor_units<>p_amount_minor_units OR v_order.currency<>p_currency THEN
    RAISE EXCEPTION 'verified_payment_mismatch';
  END IF;
  IF v_order.status NOT IN ('paid','reversed') THEN RAISE EXCEPTION 'payment_order_not_reversible'; END IF;

  INSERT INTO public.point_payment_events(
    order_id,provider,provider_event_id,event_kind,reversal_reason,
    provider_order_id,amount_minor_units,currency,audit,occurred_at,received_at
  ) VALUES (p_order_id,p_provider,p_provider_event_id,p_event_kind,p_reversal_reason,
    p_provider_order_id,p_amount_minor_units,p_currency,p_audit,p_occurred_at,p_now)
  RETURNING * INTO v_existing;

  IF v_order.status='paid' THEN
    SELECT * INTO v_lot FROM public.point_lots WHERE payment_order_id=p_order_id::TEXT AND grant_kind='purchase_bonus';
    IF FOUND THEN
      v_result:=public.reverse_point_lot(v_order.owner_id,p_bonus_reversal_event_id,
        v_lot.lot_id,v_lot.points_granted,p_reversal_reason,p_now);
      v_recovered:=v_recovered+(v_result->>'recoveredPoints')::BIGINT;
      v_shortfall:=v_shortfall+(v_result->>'shortfallPoints')::BIGINT;
    END IF;
    SELECT * INTO v_lot FROM public.point_lots WHERE payment_order_id=p_order_id::TEXT AND grant_kind='purchased';
    IF NOT FOUND THEN RAISE EXCEPTION 'purchased_point_lot_not_found'; END IF;
    v_result:=public.reverse_point_lot(v_order.owner_id,p_purchased_reversal_event_id,
      v_lot.lot_id,v_lot.points_granted,p_reversal_reason,p_now);
    v_recovered:=v_recovered+(v_result->>'recoveredPoints')::BIGINT;
    v_shortfall:=v_shortfall+(v_result->>'shortfallPoints')::BIGINT;
    UPDATE public.point_payment_orders SET status='reversed' WHERE order_id=p_order_id RETURNING * INTO v_order;
    UPDATE public.point_payment_events SET recovered_points=v_recovered,shortfall_points=v_shortfall
      WHERE payment_event_id=v_existing.payment_event_id;
  END IF;
  RETURN jsonb_build_object('order',public.point_payment_order_json(v_order),
    'account',public.point_account_snapshot(v_order.owner_id),
    'recoveredPoints',v_recovered,'shortfallPoints',v_shortfall);
END $$;

REVOKE ALL ON FUNCTION public.authorize_point_payment_checkout(UUID,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,JSONB,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reverse_point_payment(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TIMESTAMPTZ,JSONB,UUID,UUID,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_point_payment_checkout(UUID,UUID,UUID,BIGINT,TEXT,TEXT,TEXT,JSONB,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_point_payment(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TIMESTAMPTZ,JSONB,UUID,UUID,TIMESTAMPTZ) TO service_role;
