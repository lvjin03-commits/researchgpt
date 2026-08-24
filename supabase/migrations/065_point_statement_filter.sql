-- Filtered owner statements. The v1 function remains temporarily for
-- migration-first rollout compatibility and is removed after v2 verification.

CREATE OR REPLACE FUNCTION public.point_statement_for_owner_v2(
  p_owner_id UUID, p_cursor TEXT, p_limit INTEGER, p_kind TEXT
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account public.point_accounts; v_entries JSONB; v_next TEXT;
  v_cursor_time TIMESTAMPTZ; v_cursor_id UUID;
BEGIN
  IF auth.uid() IS NULL OR auth.uid()<>p_owner_id THEN RAISE EXCEPTION 'statement_owner_mismatch'; END IF;
  IF p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'invalid_statement_limit'; END IF;
  IF p_kind IS NOT NULL AND p_kind NOT IN ('grant','reserve','settle','release','reversal') THEN
    RAISE EXCEPTION 'invalid_statement_kind';
  END IF;
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
      AND (p_kind IS NULL OR transaction.kind=p_kind)
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
  IF jsonb_array_length(v_entries)>p_limit THEN v_entries:=v_entries-p_limit; ELSE v_next:=NULL; END IF;
  RETURN jsonb_build_object('availablePoints',v_account.available_points,
    'reservedPoints',v_account.reserved_points,'lifetimeSpentPoints',v_account.lifetime_spent_points,
    'entries',v_entries,'nextCursor',v_next);
END $$;

REVOKE ALL ON FUNCTION public.point_statement_for_owner_v2(UUID,TEXT,INTEGER,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.point_statement_for_owner_v2(UUID,TEXT,INTEGER,TEXT) TO authenticated;
