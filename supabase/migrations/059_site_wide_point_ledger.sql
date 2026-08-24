-- Site-wide ResearchGPT point ledger. This migration creates no checkout,
-- payment provider, price catalog or automatic AI charging path.

CREATE TABLE public.point_accounts (
  account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'risk_hold')),
  available_points BIGINT NOT NULL DEFAULT 0 CHECK (available_points >= 0),
  reserved_points BIGINT NOT NULL DEFAULT 0 CHECK (reserved_points >= 0),
  lifetime_spent_points BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_spent_points >= 0),
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.point_lots (
  lot_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.point_accounts(account_id) ON DELETE RESTRICT,
  grant_kind TEXT NOT NULL CHECK (grant_kind IN ('purchased', 'purchase_bonus', 'promotional_trial')),
  points_granted BIGINT NOT NULL CHECK (points_granted > 0),
  points_remaining BIGINT NOT NULL CHECK (points_remaining >= 0 AND points_remaining <= points_granted),
  payment_order_id TEXT,
  campaign_id TEXT,
  grant_reason TEXT NOT NULL CHECK (length(grant_reason) > 0),
  policy_version TEXT NOT NULL CHECK (length(policy_version) > 0),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE public.point_reservations (
  reservation_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.point_accounts(account_id) ON DELETE RESTRICT,
  billing_operation_id UUID NOT NULL UNIQUE,
  requested_points BIGINT NOT NULL CHECK (requested_points > 0),
  reserved_points BIGINT NOT NULL CHECK (reserved_points > 0),
  settled_points BIGINT NOT NULL DEFAULT 0 CHECK (settled_points >= 0),
  released_points BIGINT NOT NULL DEFAULT 0 CHECK (released_points >= 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  price_policy_version TEXT NOT NULL CHECK (length(price_policy_version) > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  finalized_at TIMESTAMPTZ,
  CHECK (settled_points + released_points <= reserved_points)
);

CREATE TABLE public.point_reservation_allocations (
  reservation_id UUID NOT NULL REFERENCES public.point_reservations(reservation_id) ON DELETE RESTRICT,
  lot_id UUID NOT NULL REFERENCES public.point_lots(lot_id) ON DELETE RESTRICT,
  reserved_points BIGINT NOT NULL CHECK (reserved_points > 0),
  settled_points BIGINT NOT NULL DEFAULT 0 CHECK (settled_points >= 0),
  released_points BIGINT NOT NULL DEFAULT 0 CHECK (released_points >= 0),
  PRIMARY KEY (reservation_id, lot_id),
  CHECK (settled_points + released_points <= reserved_points)
);

CREATE TABLE public.point_transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.point_accounts(account_id) ON DELETE RESTRICT,
  event_id UUID NOT NULL,
  sequence SMALLINT NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'reserve', 'settle', 'release', 'reversal')),
  lot_id UUID REFERENCES public.point_lots(lot_id) ON DELETE RESTRICT,
  reservation_id UUID REFERENCES public.point_reservations(reservation_id) ON DELETE RESTRICT,
  available_delta BIGINT NOT NULL,
  reserved_delta BIGINT NOT NULL,
  spent_delta BIGINT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (account_id, event_id, sequence)
);

CREATE TABLE public.point_recovery_shortfalls (
  shortfall_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.point_accounts(account_id) ON DELETE RESTRICT,
  lot_id UUID NOT NULL REFERENCES public.point_lots(lot_id) ON DELETE RESTRICT,
  event_id UUID NOT NULL,
  expected_points BIGINT NOT NULL CHECK (expected_points > 0),
  recovered_points BIGINT NOT NULL CHECK (recovered_points >= 0),
  shortfall_points BIGINT NOT NULL CHECK (shortfall_points > 0),
  reason TEXT NOT NULL CHECK (reason IN ('chargeback', 'forced_reversal', 'duplicate_payment')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waived', 'recovered')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (account_id, event_id)
);

CREATE INDEX point_lots_account_consumption_idx
  ON public.point_lots (account_id, expires_at, created_at)
  WHERE points_remaining > 0;
CREATE INDEX point_transactions_account_created_idx
  ON public.point_transactions (account_id, created_at DESC);
CREATE INDEX point_shortfalls_account_status_idx
  ON public.point_recovery_shortfalls (account_id, status, created_at DESC);

ALTER TABLE public.point_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_reservation_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.point_recovery_shortfalls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.point_accounts, public.point_lots, public.point_reservations,
  public.point_reservation_allocations, public.point_transactions,
  public.point_recovery_shortfalls FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.point_account_snapshot(p_owner_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN account.account_id IS NULL THEN NULL ELSE jsonb_build_object(
    'account', jsonb_build_object(
      'accountId', account.account_id, 'ownerId', account.owner_id,
      'status', account.status, 'availablePoints', account.available_points,
      'reservedPoints', account.reserved_points,
      'lifetimeSpentPoints', account.lifetime_spent_points,
      'version', account.version, 'createdAt', account.created_at,
      'updatedAt', account.updated_at
    ),
    'lots', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'lotId', lot.lot_id, 'accountId', lot.account_id, 'grantKind', lot.grant_kind,
      'pointsGranted', lot.points_granted, 'pointsRemaining', lot.points_remaining,
      'paymentOrderId', lot.payment_order_id, 'campaignId', lot.campaign_id,
      'grantReason', lot.grant_reason, 'policyVersion', lot.policy_version,
      'expiresAt', lot.expires_at, 'createdAt', lot.created_at
    ) ORDER BY lot.expires_at NULLS LAST, lot.created_at)
    FROM public.point_lots lot WHERE lot.account_id=account.account_id), '[]'::JSONB)
  ) END
  FROM (SELECT * FROM public.point_accounts WHERE owner_id=p_owner_id) account;
$$;

CREATE OR REPLACE FUNCTION public.grant_point_lot(
  p_owner_id UUID, p_event_id UUID, p_lot_id UUID, p_grant_kind TEXT,
  p_points BIGINT, p_payment_order_id TEXT, p_campaign_id TEXT,
  p_grant_reason TEXT, p_policy_version TEXT, p_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account public.point_accounts; v_existing BOOLEAN;
BEGIN
  IF p_points <= 0 OR p_grant_kind NOT IN ('purchased','purchase_bonus','promotional_trial') THEN
    RAISE EXCEPTION 'invalid_point_grant';
  END IF;
  INSERT INTO public.point_accounts(owner_id, created_at, updated_at)
  VALUES (p_owner_id, p_now, p_now) ON CONFLICT(owner_id) DO NOTHING;
  SELECT * INTO v_account FROM public.point_accounts WHERE owner_id=p_owner_id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM public.point_transactions WHERE account_id=v_account.account_id AND event_id=p_event_id) INTO v_existing;
  IF v_existing THEN RETURN public.point_account_snapshot(p_owner_id); END IF;
  IF EXISTS(SELECT 1 FROM public.point_lots WHERE lot_id=p_lot_id) THEN RAISE EXCEPTION 'point_lot_conflict'; END IF;
  INSERT INTO public.point_lots(lot_id,account_id,grant_kind,points_granted,points_remaining,payment_order_id,campaign_id,grant_reason,policy_version,expires_at,created_at)
  VALUES(p_lot_id,v_account.account_id,p_grant_kind,p_points,p_points,p_payment_order_id,p_campaign_id,p_grant_reason,p_policy_version,p_expires_at,p_now);
  UPDATE public.point_accounts SET available_points=available_points+p_points,version=version+1,updated_at=p_now WHERE account_id=v_account.account_id;
  INSERT INTO public.point_transactions(account_id,event_id,kind,lot_id,available_delta,reserved_delta,spent_delta,reason,created_at)
  VALUES(v_account.account_id,p_event_id,'grant',p_lot_id,p_points,0,0,'point_grant',p_now);
  RETURN public.point_account_snapshot(p_owner_id);
END; $$;

CREATE OR REPLACE FUNCTION public.reserve_points(
  p_owner_id UUID, p_reservation_id UUID, p_billing_operation_id UUID,
  p_points BIGINT, p_price_policy_version TEXT, p_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account public.point_accounts; v_existing public.point_reservations;
  v_lot public.point_lots; v_remaining BIGINT; v_take BIGINT;
BEGIN
  IF p_points <= 0 THEN RAISE EXCEPTION 'invalid_point_reservation'; END IF;
  SELECT reservation.* INTO v_existing FROM public.point_reservations reservation
    JOIN public.point_accounts account ON account.account_id=reservation.account_id
    WHERE reservation.billing_operation_id=p_billing_operation_id AND account.owner_id=p_owner_id;
  IF FOUND THEN RETURN to_jsonb(v_existing); END IF;
  SELECT * INTO v_account FROM public.point_accounts WHERE owner_id=p_owner_id FOR UPDATE;
  IF NOT FOUND OR v_account.available_points < p_points THEN RAISE EXCEPTION 'insufficient_points'; END IF;
  IF v_account.status <> 'active' THEN RAISE EXCEPTION 'point_account_on_hold'; END IF;
  -- A duplicate request can arrive after the first pre-lock lookup but before
  -- this account lock. Recheck while serialized so it returns the committed
  -- reservation instead of leaking a unique-key error to the caller.
  SELECT reservation.* INTO v_existing FROM public.point_reservations reservation
    WHERE reservation.billing_operation_id=p_billing_operation_id
      AND reservation.account_id=v_account.account_id;
  IF FOUND THEN RETURN to_jsonb(v_existing); END IF;
  INSERT INTO public.point_reservations(reservation_id,account_id,billing_operation_id,requested_points,reserved_points,status,price_policy_version,expires_at,created_at)
  VALUES(p_reservation_id,v_account.account_id,p_billing_operation_id,p_points,p_points,'reserved',p_price_policy_version,p_expires_at,p_now);
  v_remaining := p_points;
  FOR v_lot IN SELECT * FROM public.point_lots
    WHERE account_id=v_account.account_id AND points_remaining>0 AND (expires_at IS NULL OR expires_at>p_now)
    ORDER BY expires_at NULLS LAST,
      CASE grant_kind WHEN 'purchase_bonus' THEN 0 WHEN 'promotional_trial' THEN 1 ELSE 2 END,
      created_at FOR UPDATE
  LOOP
    EXIT WHEN v_remaining=0;
    v_take := LEAST(v_lot.points_remaining,v_remaining);
    UPDATE public.point_lots SET points_remaining=points_remaining-v_take WHERE lot_id=v_lot.lot_id;
    INSERT INTO public.point_reservation_allocations(reservation_id,lot_id,reserved_points) VALUES(p_reservation_id,v_lot.lot_id,v_take);
    v_remaining := v_remaining-v_take;
  END LOOP;
  IF v_remaining<>0 THEN RAISE EXCEPTION 'point_account_lot_divergence'; END IF;
  UPDATE public.point_accounts SET available_points=available_points-p_points,reserved_points=reserved_points+p_points,version=version+1,updated_at=p_now WHERE account_id=v_account.account_id;
  INSERT INTO public.point_transactions(account_id,event_id,kind,reservation_id,available_delta,reserved_delta,spent_delta,reason,created_at)
  VALUES(v_account.account_id,p_billing_operation_id,'reserve',p_reservation_id,-p_points,p_points,0,'point_reservation',p_now);
  SELECT * INTO v_existing FROM public.point_reservations WHERE reservation_id=p_reservation_id;
  RETURN to_jsonb(v_existing);
END; $$;

CREATE OR REPLACE FUNCTION public.settle_point_reservation(
  p_owner_id UUID, p_event_id UUID, p_reservation_id UUID,
  p_settled_points BIGINT, p_reason TEXT, p_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account public.point_accounts; v_reservation public.point_reservations;
  v_allocation public.point_reservation_allocations; v_remaining BIGINT;
  v_settled BIGINT; v_released BIGINT:=0; v_sequence SMALLINT:=0;
BEGIN
  SELECT account.* INTO v_account FROM public.point_accounts account
    JOIN public.point_reservations reservation ON reservation.account_id=account.account_id
    WHERE account.owner_id=p_owner_id AND reservation.reservation_id=p_reservation_id FOR UPDATE OF account;
  IF NOT FOUND THEN RAISE EXCEPTION 'point_reservation_not_found'; END IF;
  IF EXISTS(SELECT 1 FROM public.point_transactions WHERE account_id=v_account.account_id AND event_id=p_event_id) THEN
    SELECT * INTO v_reservation FROM public.point_reservations WHERE reservation_id=p_reservation_id; RETURN to_jsonb(v_reservation);
  END IF;
  SELECT * INTO v_reservation FROM public.point_reservations WHERE reservation_id=p_reservation_id FOR UPDATE;
  IF v_reservation.status<>'reserved' THEN RETURN to_jsonb(v_reservation); END IF;
  IF p_settled_points<0 OR p_settled_points>v_reservation.reserved_points THEN RAISE EXCEPTION 'invalid_point_settlement'; END IF;
  v_remaining:=p_settled_points;
  FOR v_allocation IN SELECT * FROM public.point_reservation_allocations WHERE reservation_id=p_reservation_id ORDER BY lot_id FOR UPDATE
  LOOP
    v_settled:=LEAST(v_allocation.reserved_points,v_remaining);
    v_remaining:=v_remaining-v_settled;
    UPDATE public.point_reservation_allocations SET settled_points=v_settled,released_points=reserved_points-v_settled WHERE reservation_id=p_reservation_id AND lot_id=v_allocation.lot_id;
    UPDATE public.point_lots SET points_remaining=points_remaining+(v_allocation.reserved_points-v_settled) WHERE lot_id=v_allocation.lot_id;
    v_released:=v_released+(v_allocation.reserved_points-v_settled);
  END LOOP;
  UPDATE public.point_reservations SET settled_points=p_settled_points,released_points=v_released,status='settled',finalized_at=p_now WHERE reservation_id=p_reservation_id RETURNING * INTO v_reservation;
  UPDATE public.point_accounts SET available_points=available_points+v_released,reserved_points=reserved_points-v_reservation.reserved_points,lifetime_spent_points=lifetime_spent_points+p_settled_points,version=version+1,updated_at=p_now WHERE account_id=v_account.account_id;
  INSERT INTO public.point_transactions(account_id,event_id,sequence,kind,reservation_id,available_delta,reserved_delta,spent_delta,reason,created_at)
  VALUES(v_account.account_id,p_event_id,v_sequence,'settle',p_reservation_id,0,-p_settled_points,p_settled_points,p_reason,p_now);
  IF v_released>0 THEN INSERT INTO public.point_transactions(account_id,event_id,sequence,kind,reservation_id,available_delta,reserved_delta,spent_delta,reason,created_at)
    VALUES(v_account.account_id,p_event_id,1,'release',p_reservation_id,v_released,-v_released,0,'unused_reservation',p_now); END IF;
  RETURN to_jsonb(v_reservation);
END; $$;

CREATE OR REPLACE FUNCTION public.release_point_reservation(
  p_owner_id UUID, p_event_id UUID, p_reservation_id UUID,
  p_reason TEXT, p_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account public.point_accounts; v_reservation public.point_reservations; v_allocation public.point_reservation_allocations;
BEGIN
  SELECT account.* INTO v_account FROM public.point_accounts account JOIN public.point_reservations reservation ON reservation.account_id=account.account_id
    WHERE account.owner_id=p_owner_id AND reservation.reservation_id=p_reservation_id FOR UPDATE OF account;
  IF NOT FOUND THEN RAISE EXCEPTION 'point_reservation_not_found'; END IF;
  IF EXISTS(SELECT 1 FROM public.point_transactions WHERE account_id=v_account.account_id AND event_id=p_event_id) THEN SELECT * INTO v_reservation FROM public.point_reservations WHERE reservation_id=p_reservation_id; RETURN to_jsonb(v_reservation); END IF;
  SELECT * INTO v_reservation FROM public.point_reservations WHERE reservation_id=p_reservation_id FOR UPDATE;
  IF v_reservation.status<>'reserved' THEN RETURN to_jsonb(v_reservation); END IF;
  FOR v_allocation IN SELECT * FROM public.point_reservation_allocations WHERE reservation_id=p_reservation_id FOR UPDATE LOOP
    UPDATE public.point_lots SET points_remaining=points_remaining+v_allocation.reserved_points WHERE lot_id=v_allocation.lot_id;
    UPDATE public.point_reservation_allocations SET released_points=reserved_points WHERE reservation_id=p_reservation_id AND lot_id=v_allocation.lot_id;
  END LOOP;
  UPDATE public.point_reservations SET released_points=reserved_points,status='released',finalized_at=p_now WHERE reservation_id=p_reservation_id RETURNING * INTO v_reservation;
  UPDATE public.point_accounts SET available_points=available_points+v_reservation.reserved_points,reserved_points=reserved_points-v_reservation.reserved_points,version=version+1,updated_at=p_now WHERE account_id=v_account.account_id;
  INSERT INTO public.point_transactions(account_id,event_id,kind,reservation_id,available_delta,reserved_delta,spent_delta,reason,created_at)
  VALUES(v_account.account_id,p_event_id,'release',p_reservation_id,v_reservation.reserved_points,-v_reservation.reserved_points,0,p_reason,p_now);
  RETURN to_jsonb(v_reservation);
END; $$;

CREATE OR REPLACE FUNCTION public.reverse_point_lot(
  p_owner_id UUID, p_event_id UUID, p_lot_id UUID, p_points BIGINT,
  p_reason TEXT, p_now TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account public.point_accounts; v_lot public.point_lots; v_recovered BIGINT; v_shortfall BIGINT;
BEGIN
  IF p_points<=0 OR p_reason NOT IN ('chargeback','forced_reversal','duplicate_payment') THEN RAISE EXCEPTION 'invalid_point_reversal'; END IF;
  SELECT account.* INTO v_account FROM public.point_accounts account JOIN public.point_lots lot ON lot.account_id=account.account_id
    WHERE account.owner_id=p_owner_id AND lot.lot_id=p_lot_id FOR UPDATE OF account;
  IF NOT FOUND THEN RAISE EXCEPTION 'point_lot_not_found'; END IF;
  IF EXISTS(SELECT 1 FROM public.point_transactions WHERE account_id=v_account.account_id AND event_id=p_event_id) THEN
    SELECT COALESCE(-available_delta,0) INTO v_recovered FROM public.point_transactions WHERE account_id=v_account.account_id AND event_id=p_event_id AND kind='reversal' LIMIT 1;
    SELECT COALESCE(shortfall_points,0) INTO v_shortfall FROM public.point_recovery_shortfalls WHERE account_id=v_account.account_id AND event_id=p_event_id;
    RETURN jsonb_build_object('recoveredPoints',v_recovered,'shortfallPoints',COALESCE(v_shortfall,0),'account',public.point_account_snapshot(p_owner_id)->'account');
  END IF;
  SELECT * INTO v_lot FROM public.point_lots WHERE lot_id=p_lot_id FOR UPDATE;
  v_recovered:=LEAST(v_lot.points_remaining,p_points); v_shortfall:=p_points-v_recovered;
  UPDATE public.point_lots SET points_remaining=points_remaining-v_recovered WHERE lot_id=p_lot_id;
  UPDATE public.point_accounts SET available_points=available_points-v_recovered,status=CASE WHEN v_shortfall>0 THEN 'risk_hold' ELSE status END,version=version+1,updated_at=p_now WHERE account_id=v_account.account_id;
  INSERT INTO public.point_transactions(account_id,event_id,kind,lot_id,available_delta,reserved_delta,spent_delta,reason,created_at)
  VALUES(v_account.account_id,p_event_id,'reversal',p_lot_id,-v_recovered,0,0,p_reason,p_now);
  IF v_shortfall>0 THEN INSERT INTO public.point_recovery_shortfalls(account_id,lot_id,event_id,expected_points,recovered_points,shortfall_points,reason,created_at)
    VALUES(v_account.account_id,p_lot_id,p_event_id,p_points,v_recovered,v_shortfall,p_reason,p_now); END IF;
  RETURN jsonb_build_object('recoveredPoints',v_recovered,'shortfallPoints',v_shortfall,'account',public.point_account_snapshot(p_owner_id)->'account');
END; $$;

REVOKE ALL ON FUNCTION public.point_account_snapshot(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_point_lot(UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_points(UUID,UUID,UUID,BIGINT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_point_reservation(UUID,UUID,UUID,BIGINT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_point_reservation(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_point_lot(UUID,UUID,UUID,BIGINT,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.point_account_snapshot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_point_lot(UUID,UUID,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_points(UUID,UUID,UUID,BIGINT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_point_reservation(UUID,UUID,UUID,BIGINT,TEXT,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_point_reservation(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_point_lot(UUID,UUID,UUID,BIGINT,TEXT,TIMESTAMPTZ) TO service_role;
