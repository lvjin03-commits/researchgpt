-- Owner-visible order projection and recharge continuation intents.
-- This migration does not enable checkout or charging.

CREATE TABLE IF NOT EXISTS public.account_resume_intents (
  resume_intent_id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL,
  required_points BIGINT NOT NULL CHECK (required_points > 0),
  context JSONB NOT NULL CHECK (jsonb_typeof(context)='object'),
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment','needs_revalidation','ready','stale','consumed','cancelled','expired')),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revalidated_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS account_resume_intents_owner_created_idx
  ON public.account_resume_intents(owner_id,created_at DESC);
ALTER TABLE public.account_resume_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_resume_intents FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.resume_intent_json(p_intent public.account_resume_intents)
RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'resumeIntentId',p_intent.resume_intent_id,'ownerId',p_intent.owner_id,
    'operation',p_intent.operation,'requiredPoints',p_intent.required_points,
    'context',p_intent.context,'status',p_intent.status,
    'createdAt',p_intent.created_at,'expiresAt',p_intent.expires_at,
    'revalidatedAt',p_intent.revalidated_at,'consumedAt',p_intent.consumed_at
  )
$$;

CREATE OR REPLACE FUNCTION public.create_resume_intent(p_intent JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_intent public.account_resume_intents; v_owner UUID;
BEGIN
  v_owner:=(p_intent->>'ownerId')::UUID;
  IF (p_intent->>'requiredPoints')::BIGINT<=0
     OR (p_intent->>'expiresAt')::TIMESTAMPTZ<=(p_intent->>'createdAt')::TIMESTAMPTZ
     OR jsonb_typeof(p_intent->'context')<>'object' THEN RAISE EXCEPTION 'invalid_resume_intent'; END IF;
  INSERT INTO public.account_resume_intents(
    resume_intent_id,owner_id,operation,required_points,context,status,created_at,expires_at
  ) VALUES (
    (p_intent->>'resumeIntentId')::UUID,v_owner,p_intent->>'operation',
    (p_intent->>'requiredPoints')::BIGINT,p_intent->'context','awaiting_payment',
    (p_intent->>'createdAt')::TIMESTAMPTZ,(p_intent->>'expiresAt')::TIMESTAMPTZ
  ) RETURNING * INTO v_intent;
  RETURN public.resume_intent_json(v_intent);
END $$;

CREATE OR REPLACE FUNCTION public.resume_intent_for_owner(p_resume_intent_id UUID,p_owner_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.resume_intent_json(intent) FROM public.account_resume_intents intent
  WHERE intent.resume_intent_id=p_resume_intent_id AND intent.owner_id=p_owner_id
$$;

CREATE OR REPLACE FUNCTION public.transition_resume_intent(
  p_resume_intent_id UUID,p_owner_id UUID,p_from_statuses TEXT[],p_to_status TEXT,p_now TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_intent public.account_resume_intents;
BEGIN
  IF p_to_status NOT IN ('ready','stale','consumed','cancelled','expired') THEN RAISE EXCEPTION 'invalid_resume_transition'; END IF;
  UPDATE public.account_resume_intents SET status=p_to_status,
    revalidated_at=CASE WHEN p_to_status IN ('ready','stale') THEN p_now ELSE revalidated_at END,
    consumed_at=CASE WHEN p_to_status='consumed' THEN p_now ELSE consumed_at END
  WHERE resume_intent_id=p_resume_intent_id AND owner_id=p_owner_id
    AND status=ANY(p_from_statuses) AND expires_at>p_now
  RETURNING * INTO v_intent;
  IF NOT FOUND THEN RAISE EXCEPTION 'resume_intent_transition_conflict'; END IF;
  RETURN public.resume_intent_json(v_intent);
END $$;

CREATE OR REPLACE FUNCTION public.point_payment_orders_for_owner(
  p_owner_id UUID,p_cursor TEXT,p_limit INTEGER,p_status TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_orders JSONB; v_next TEXT; v_cursor_time TIMESTAMPTZ; v_cursor_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid()<>p_owner_id THEN RAISE EXCEPTION 'payment_order_owner_mismatch'; END IF;
  IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'invalid_order_limit'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending','paid','failed','closed','reversed') THEN RAISE EXCEPTION 'invalid_order_status'; END IF;
  IF p_cursor IS NOT NULL THEN v_cursor_time:=split_part(p_cursor,'|',1)::TIMESTAMPTZ; v_cursor_id:=split_part(p_cursor,'|',2)::UUID; END IF;
  WITH rows AS (
    SELECT payment_order.*,ROW_NUMBER() OVER (ORDER BY created_at DESC,order_id DESC) ordinal
    FROM public.point_payment_orders payment_order
    WHERE owner_id=p_owner_id AND (p_status IS NULL OR status=p_status)
      AND (p_cursor IS NULL OR (created_at,order_id)<(v_cursor_time,v_cursor_id))
    ORDER BY created_at DESC,order_id DESC LIMIT p_limit+1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'orderId',order_id,'ownerId',owner_id,'provider',provider,
    'merchantAccountId',merchant_account_id,'providerOrderId',provider_order_id,
    'status',status,'purchasedPoints',purchased_points,'bonusPoints',bonus_points,
    'amountMinorUnits',amount_minor_units,'currency',currency,
    'purchasePolicyVersion',purchase_policy_version,
    'bonusCampaignVersion',bonus_campaign_version,
    'returnContextId',return_context_id,'createdAt',created_at,'paidAt',paid_at
  ) ORDER BY ordinal),'[]'::JSONB),
    MAX(created_at::TEXT||'|'||order_id::TEXT) FILTER(WHERE ordinal=p_limit)
  INTO v_orders,v_next FROM rows WHERE ordinal<=p_limit OR ordinal=p_limit+1;
  IF jsonb_array_length(v_orders)>p_limit THEN v_orders:=v_orders-p_limit; ELSE v_next:=NULL; END IF;
  RETURN jsonb_build_object('orders',v_orders,'nextCursor',v_next);
END $$;

CREATE OR REPLACE FUNCTION public.activate_resume_intent_after_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.return_context_id IS NOT NULL THEN
    UPDATE public.account_resume_intents SET status='needs_revalidation'
    WHERE resume_intent_id=NEW.return_context_id AND owner_id=NEW.owner_id
      AND status='awaiting_payment' AND expires_at>COALESCE(NEW.paid_at,now());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS activate_resume_intent_after_payment ON public.point_payment_orders;
CREATE TRIGGER activate_resume_intent_after_payment
AFTER UPDATE OF status ON public.point_payment_orders
FOR EACH ROW EXECUTE FUNCTION public.activate_resume_intent_after_payment();

REVOKE ALL ON FUNCTION public.create_resume_intent(JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.resume_intent_for_owner(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.transition_resume_intent(UUID,UUID,TEXT[],TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.point_payment_orders_for_owner(UUID,TEXT,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_resume_intent(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_intent_for_owner(UUID,UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_resume_intent(UUID,UUID,TEXT[],TEXT,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.point_payment_orders_for_owner(UUID,TEXT,INTEGER,TEXT) TO authenticated;
