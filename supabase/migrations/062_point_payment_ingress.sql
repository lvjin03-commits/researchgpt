-- Provider-neutral payment orders and verified successful events.
-- No production provider is enabled by this migration.

CREATE TABLE IF NOT EXISTS public.point_payment_orders (
  order_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  merchant_account_id TEXT NOT NULL,
  provider_order_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','closed','reversed')),
  purchased_points BIGINT NOT NULL CHECK (purchased_points > 0),
  bonus_points BIGINT NOT NULL CHECK (bonus_points >= 0),
  amount_minor_units BIGINT NOT NULL CHECK (amount_minor_units > 0),
  currency TEXT NOT NULL CHECK (currency = 'CNY'),
  purchase_policy_version TEXT NOT NULL,
  bonus_campaign_version TEXT NOT NULL,
  return_context_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  UNIQUE(provider, merchant_account_id, provider_order_id)
);

CREATE TABLE IF NOT EXISTS public.point_payment_events (
  payment_event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.point_payment_orders(order_id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind = 'payment_succeeded'),
  provider_order_id TEXT NOT NULL,
  amount_minor_units BIGINT NOT NULL CHECK (amount_minor_units > 0),
  currency TEXT NOT NULL,
  audit JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  UNIQUE(provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS point_payment_orders_owner_created_idx
  ON public.point_payment_orders(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS point_payment_events_order_received_idx
  ON public.point_payment_events(order_id, received_at DESC);

ALTER TABLE public.point_payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.point_payment_orders, public.point_payment_events
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.point_payment_order_json(p_order public.point_payment_orders)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'orderId', p_order.order_id, 'ownerId', p_order.owner_id,
    'provider', p_order.provider, 'merchantAccountId', p_order.merchant_account_id,
    'providerOrderId', p_order.provider_order_id, 'status', p_order.status,
    'purchasedPoints', p_order.purchased_points, 'bonusPoints', p_order.bonus_points,
    'amountMinorUnits', p_order.amount_minor_units, 'currency', p_order.currency,
    'purchasePolicyVersion', p_order.purchase_policy_version,
    'bonusCampaignVersion', p_order.bonus_campaign_version,
    'returnContextId', p_order.return_context_id, 'createdAt', p_order.created_at,
    'paidAt', p_order.paid_at
  )
$$;

CREATE OR REPLACE FUNCTION public.create_point_payment_order(p_order JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.point_payment_orders;
BEGIN
  IF (p_order->>'amountMinorUnits')::BIGINT <> (p_order->>'purchasedPoints')::BIGINT
     OR p_order->>'currency' <> 'CNY'
     OR p_order->>'purchasePolicyVersion' <> 'point-purchase-v1'
     OR p_order->>'bonusCampaignVersion' <> 'launch-bonus-v1'
     OR (p_order->>'bonusPoints')::BIGINT <> FLOOR((p_order->>'purchasedPoints')::NUMERIC * 1300 / 10000) THEN
    RAISE EXCEPTION 'payment_order_policy_mismatch';
  END IF;
  INSERT INTO public.point_payment_orders(
    order_id,owner_id,provider,merchant_account_id,status,purchased_points,
    bonus_points,amount_minor_units,currency,purchase_policy_version,
    bonus_campaign_version,return_context_id,created_at
  ) VALUES (
    (p_order->>'orderId')::UUID,(p_order->>'ownerId')::UUID,p_order->>'provider',
    p_order->>'merchantAccountId','pending',(p_order->>'purchasedPoints')::BIGINT,
    (p_order->>'bonusPoints')::BIGINT,(p_order->>'amountMinorUnits')::BIGINT,
    p_order->>'currency',p_order->>'purchasePolicyVersion',
    p_order->>'bonusCampaignVersion',(p_order->>'returnContextId')::UUID,
    (p_order->>'createdAt')::TIMESTAMPTZ
  ) RETURNING * INTO v_order;
  RETURN public.point_payment_order_json(v_order);
END $$;

CREATE OR REPLACE FUNCTION public.attach_point_provider_order(
  p_order_id UUID, p_owner_id UUID, p_provider_order_id TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.point_payment_orders;
BEGIN
  UPDATE public.point_payment_orders SET provider_order_id=p_provider_order_id
    WHERE order_id=p_order_id AND owner_id=p_owner_id AND status='pending'
      AND provider_order_id IS NULL RETURNING * INTO v_order;
  IF NOT FOUND THEN
    SELECT * INTO v_order FROM public.point_payment_orders
      WHERE order_id=p_order_id AND owner_id=p_owner_id AND provider_order_id=p_provider_order_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_order_attach_conflict'; END IF;
  RETURN public.point_payment_order_json(v_order);
END $$;

CREATE OR REPLACE FUNCTION public.point_payment_order_for_owner(p_order_id UUID, p_owner_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.point_payment_order_json(payment_order)
  FROM public.point_payment_orders payment_order
  WHERE payment_order.order_id=p_order_id AND payment_order.owner_id=p_owner_id
$$;

CREATE OR REPLACE FUNCTION public.confirm_point_payment(
  p_provider_event_id TEXT, p_provider TEXT, p_merchant_account_id TEXT,
  p_provider_order_id TEXT, p_order_id UUID, p_amount_minor_units BIGINT,
  p_currency TEXT, p_occurred_at TIMESTAMPTZ, p_audit JSONB,
  p_purchased_lot_id UUID, p_bonus_lot_id UUID,
  p_purchased_grant_event_id UUID, p_bonus_grant_event_id UUID,
  p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.point_payment_orders; v_existing_order_id UUID; v_account JSONB;
BEGIN
  SELECT order_id INTO v_existing_order_id FROM public.point_payment_events
    WHERE provider=p_provider AND provider_event_id=p_provider_event_id;
  IF FOUND THEN
    IF v_existing_order_id <> p_order_id THEN RAISE EXCEPTION 'provider_event_conflict'; END IF;
    SELECT * INTO v_order FROM public.point_payment_orders WHERE order_id=p_order_id;
    RETURN jsonb_build_object('order',public.point_payment_order_json(v_order),'account',public.point_account_snapshot(v_order.owner_id));
  END IF;

  SELECT * INTO v_order FROM public.point_payment_orders WHERE order_id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_order_not_found'; END IF;
  -- A duplicate webhook can pass the first lookup while the original request
  -- is still uncommitted. Recheck after serializing on the order row.
  SELECT order_id INTO v_existing_order_id FROM public.point_payment_events
    WHERE provider=p_provider AND provider_event_id=p_provider_event_id;
  IF FOUND THEN
    IF v_existing_order_id <> p_order_id THEN RAISE EXCEPTION 'provider_event_conflict'; END IF;
    RETURN jsonb_build_object('order',public.point_payment_order_json(v_order),'account',public.point_account_snapshot(v_order.owner_id));
  END IF;
  IF v_order.provider<>p_provider OR v_order.merchant_account_id<>p_merchant_account_id
     OR v_order.provider_order_id<>p_provider_order_id
     OR v_order.amount_minor_units<>p_amount_minor_units OR v_order.currency<>p_currency THEN
    RAISE EXCEPTION 'verified_payment_mismatch';
  END IF;
  IF v_order.status NOT IN ('pending','paid') THEN RAISE EXCEPTION 'payment_order_not_payable'; END IF;

  INSERT INTO public.point_payment_events(
    order_id,provider,provider_event_id,event_kind,provider_order_id,
    amount_minor_units,currency,audit,occurred_at,received_at
  ) VALUES (p_order_id,p_provider,p_provider_event_id,'payment_succeeded',
    p_provider_order_id,p_amount_minor_units,p_currency,p_audit,p_occurred_at,p_now);

  IF v_order.status='pending' THEN
    UPDATE public.point_payment_orders SET status='paid',paid_at=p_occurred_at
      WHERE order_id=p_order_id RETURNING * INTO v_order;
    v_account := public.grant_point_lot(
      v_order.owner_id,p_purchased_grant_event_id,p_purchased_lot_id,'purchased',
      v_order.purchased_points,v_order.order_id::TEXT,NULL,'point_purchase',
      v_order.purchase_policy_version,NULL,p_now);
    IF v_order.bonus_points>0 THEN
      v_account := public.grant_point_lot(
        v_order.owner_id,p_bonus_grant_event_id,p_bonus_lot_id,'purchase_bonus',
        v_order.bonus_points,v_order.order_id::TEXT,v_order.bonus_campaign_version,
        'purchase_bonus',v_order.bonus_campaign_version,NULL,p_now);
    END IF;
  ELSE
    v_account := public.point_account_snapshot(v_order.owner_id);
  END IF;
  RETURN jsonb_build_object('order',public.point_payment_order_json(v_order),'account',v_account);
END $$;

REVOKE ALL ON FUNCTION public.create_point_payment_order(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attach_point_provider_order(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_point_payment(TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TIMESTAMPTZ,JSONB,UUID,UUID,UUID,UUID,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.point_payment_order_for_owner(UUID,UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_point_payment_order(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_point_provider_order(UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_point_payment(TEXT,TEXT,TEXT,TEXT,UUID,BIGINT,TEXT,TIMESTAMPTZ,JSONB,UUID,UUID,UUID,UUID,TIMESTAMPTZ) TO service_role;
