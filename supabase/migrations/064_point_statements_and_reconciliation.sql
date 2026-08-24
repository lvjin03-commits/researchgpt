-- Read-only user statements and service-role reconciliation projections.
-- These functions never mutate payment or point state.

CREATE OR REPLACE FUNCTION public.point_statement_for_owner(
  p_owner_id UUID, p_cursor TEXT, p_limit INTEGER
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account public.point_accounts; v_entries JSONB; v_next TEXT;
  v_cursor_time TIMESTAMPTZ; v_cursor_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid()<>p_owner_id THEN RAISE EXCEPTION 'statement_owner_mismatch'; END IF;
  IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'invalid_statement_limit'; END IF;
  IF p_cursor IS NOT NULL THEN
    v_cursor_time:=split_part(p_cursor,'|',1)::TIMESTAMPTZ;
    v_cursor_id:=split_part(p_cursor,'|',2)::UUID;
  END IF;
  SELECT * INTO v_account FROM public.point_accounts WHERE owner_id=p_owner_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('availablePoints',0,'reservedPoints',0,'lifetimeSpentPoints',0,'entries','[]'::JSONB,'nextCursor',NULL);
  END IF;
  WITH rows AS (
    SELECT transaction.*, reservation.billing_operation_id,reservation.price_policy_version,
      policy.operation,lot.payment_order_id,lot.grant_kind,
      ROW_NUMBER() OVER (ORDER BY transaction.created_at DESC,transaction.transaction_id DESC) AS ordinal
    FROM public.point_transactions transaction
    LEFT JOIN public.point_reservations reservation ON reservation.reservation_id=transaction.reservation_id
    LEFT JOIN public.ai_price_policies policy ON policy.policy_version=reservation.price_policy_version
    LEFT JOIN public.point_lots lot ON lot.lot_id=transaction.lot_id
    WHERE transaction.account_id=v_account.account_id
      AND (p_cursor IS NULL OR (transaction.created_at,transaction.transaction_id)<(v_cursor_time,v_cursor_id))
    ORDER BY transaction.created_at DESC,transaction.transaction_id DESC LIMIT p_limit+1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'transactionId',transaction_id,'occurredAt',created_at,'kind',kind,
    'availableDelta',available_delta,'reservedDelta',reserved_delta,'spentDelta',spent_delta,
    'operation',operation,'billingOperationId',billing_operation_id,
    'pricePolicyVersion',price_policy_version,'paymentOrderId',payment_order_id,
    'grantKind',grant_kind,'reason',reason
  ) ORDER BY ordinal),'[]'::JSONB), MAX(created_at::TEXT||'|'||transaction_id::TEXT) FILTER (WHERE ordinal=p_limit)
  INTO v_entries,v_next FROM rows WHERE ordinal<=p_limit OR ordinal=p_limit+1;
  -- Remove the look-ahead row from the returned page while retaining its cursor.
  IF jsonb_array_length(v_entries)>p_limit THEN
    v_entries:=v_entries-p_limit;
  ELSE
    v_next:=NULL;
  END IF;
  RETURN jsonb_build_object('availablePoints',v_account.available_points,
    'reservedPoints',v_account.reserved_points,'lifetimeSpentPoints',v_account.lifetime_spent_points,
    'entries',v_entries,'nextCursor',v_next);
END $$;

CREATE OR REPLACE FUNCTION public.list_payment_orders_for_reconciliation(
  p_provider TEXT,p_merchant_account_id TEXT,p_from TIMESTAMPTZ,p_to TIMESTAMPTZ
) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'orderId',order_id,'provider',provider,'merchantAccountId',merchant_account_id,
    'providerOrderId',provider_order_id,'status',status,
    'amountMinorUnits',amount_minor_units,'currency',currency
  ) ORDER BY created_at),'[]'::JSONB)
  FROM public.point_payment_orders
  WHERE provider=p_provider AND merchant_account_id=p_merchant_account_id
    AND created_at>=p_from AND created_at<p_to AND provider_order_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.inspect_point_billing_invariants()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH findings AS (
    SELECT 'missing_payment_event'::TEXT code, payment.provider_order_id,
      payment.order_id,jsonb_build_object('status',payment.status) details
    FROM public.point_payment_orders payment
    WHERE payment.status IN ('paid','reversed') AND NOT EXISTS(
      SELECT 1 FROM public.point_payment_events event
      WHERE event.order_id=payment.order_id AND event.event_kind='payment_succeeded')
    UNION ALL
    SELECT 'missing_purchased_lot',payment.provider_order_id,payment.order_id,
      jsonb_build_object('status',payment.status)
    FROM public.point_payment_orders payment
    WHERE payment.status IN ('paid','reversed') AND NOT EXISTS(
      SELECT 1 FROM public.point_lots lot
      WHERE lot.payment_order_id=payment.order_id::TEXT AND lot.grant_kind='purchased')
    UNION ALL
    SELECT 'point_grant_mismatch',payment.provider_order_id,payment.order_id,
      jsonb_build_object('expectedPoints',payment.purchased_points+payment.bonus_points,
        'actualPoints',COALESCE(SUM(lot.points_granted),0))
    FROM public.point_payment_orders payment LEFT JOIN public.point_lots lot
      ON lot.payment_order_id=payment.order_id::TEXT
    WHERE payment.status IN ('paid','reversed')
    GROUP BY payment.order_id,payment.provider_order_id,payment.purchased_points,payment.bonus_points
    HAVING COALESCE(SUM(lot.points_granted),0)<>payment.purchased_points+payment.bonus_points
    UNION ALL
    SELECT 'account_available_mismatch',NULL,NULL,
      jsonb_build_object('accountId',account.account_id::TEXT,'accountAvailable',account.available_points,
        'lotAvailable',COALESCE(SUM(lot.points_remaining),0))
    FROM public.point_accounts account LEFT JOIN public.point_lots lot ON lot.account_id=account.account_id
    GROUP BY account.account_id,account.available_points
    HAVING account.available_points<>COALESCE(SUM(lot.points_remaining),0)
    UNION ALL
    SELECT 'account_reserved_mismatch',NULL,NULL,
      jsonb_build_object('accountId',account.account_id::TEXT,'accountReserved',account.reserved_points,
        'reservationTotal',COALESCE(SUM(reservation.reserved_points),0))
    FROM public.point_accounts account LEFT JOIN public.point_reservations reservation
      ON reservation.account_id=account.account_id AND reservation.status='reserved'
    GROUP BY account.account_id,account.reserved_points
    HAVING account.reserved_points<>COALESCE(SUM(reservation.reserved_points),0)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code',code,'providerOrderId',provider_order_id,
    'orderId',order_id,'details',details)),'[]'::JSONB) FROM findings
$$;

REVOKE ALL ON FUNCTION public.point_statement_for_owner(UUID,TEXT,INTEGER) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.point_statement_for_owner(UUID,TEXT,INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION public.list_payment_orders_for_reconciliation(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.inspect_point_billing_invariants() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_payment_orders_for_reconciliation(TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.inspect_point_billing_invariants() TO service_role;
