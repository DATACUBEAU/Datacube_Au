-- Keep the optional legacy subscriptions mirror compatible without making the
-- removed public.subscriptions table a compile-time dependency of the
-- authoritative billing path.

CREATE OR REPLACE FUNCTION public.apply_verified_billing_payment(
  p_user_id UUID,
  p_reference TEXT,
  p_amount_kobo BIGINT,
  p_channel TEXT DEFAULT 'unknown',
  p_status TEXT DEFAULT 'success',
  p_paid_at TIMESTAMPTZ DEFAULT NULL,
  p_raw_event_json JSONB DEFAULT '{}'::jsonb,
  p_idempotency_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_gateway TEXT DEFAULT 'paystack',
  p_plan_key TEXT DEFAULT NULL,
  p_interval TEXT DEFAULT 'monthly',
  p_charge_method TEXT DEFAULT 'subscription',
  p_transaction_id TEXT DEFAULT NULL,
  p_customer_email TEXT DEFAULT NULL,
  p_customer_code TEXT DEFAULT NULL,
  p_authorization_code TEXT DEFAULT NULL,
  p_subscription_code TEXT DEFAULT NULL,
  p_subscription_email_token TEXT DEFAULT NULL,
  p_trace_id TEXT DEFAULT NULL,
  p_transition_kind TEXT DEFAULT 'renewal'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_reference TEXT := NULLIF(TRIM(COALESCE(p_reference, '')), '');
  v_plan_key TEXT := NULLIF(TRIM(COALESCE(p_plan_key, '')), '');
  v_interval TEXT := CASE WHEN LOWER(TRIM(COALESCE(p_interval, 'monthly'))) = 'weekly' THEN 'weekly' ELSE 'monthly' END;
  v_charge_method TEXT := CASE WHEN LOWER(TRIM(COALESCE(p_charge_method, 'subscription'))) = 'transfer' THEN 'transfer' ELSE 'subscription' END;
  v_status TEXT := LOWER(TRIM(COALESCE(p_status, 'pending')));
  v_grant_id BIGINT := NULL;
  v_active_end TIMESTAMPTZ := NULL;
  v_starts_at TIMESTAMPTZ := v_now;
  v_ends_at TIMESTAMPTZ := v_now;
  v_days INT := CASE WHEN v_interval = 'weekly' THEN 7 ELSE 30 END;
  v_transition JSONB := '{}'::jsonb;
  v_subscription JSONB := '{}'::jsonb;
  v_transaction_metadata JSONB := jsonb_strip_nulls(COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'gateway', p_gateway,
    'gateway_transaction_id', NULLIF(TRIM(COALESCE(p_transaction_id, '')), ''),
    'authorization_code', NULLIF(TRIM(COALESCE(p_authorization_code, '')), ''),
    'customer_code', NULLIF(TRIM(COALESCE(p_customer_code, '')), ''),
    'subscription_code', NULLIF(TRIM(COALESCE(p_subscription_code, '')), ''),
    'subscription_email_token', NULLIF(TRIM(COALESCE(p_subscription_email_token, '')), '')
  ));
BEGIN
  IF v_reference IS NULL THEN
    RAISE EXCEPTION 'p_reference is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(COALESCE(p_user_id::text, v_reference)));

  INSERT INTO public.billing_transactions (
    user_id,
    reference,
    amount_kobo,
    channel,
    status,
    paid_at,
    raw_event_json,
    idempotency_key,
    metadata,
    updated_at
  )
  VALUES (
    p_user_id,
    v_reference,
    GREATEST(COALESCE(p_amount_kobo, 0), 0),
    COALESCE(NULLIF(TRIM(COALESCE(p_channel, '')), ''), 'unknown'),
    v_status,
    p_paid_at,
    COALESCE(p_raw_event_json, '{}'::jsonb),
    NULLIF(TRIM(COALESCE(p_idempotency_key, '')), ''),
    COALESCE(v_transaction_metadata, '{}'::jsonb),
    v_now
  )
  ON CONFLICT (reference) DO UPDATE
  SET
    user_id = COALESCE(EXCLUDED.user_id, public.billing_transactions.user_id),
    amount_kobo = EXCLUDED.amount_kobo,
    channel = EXCLUDED.channel,
    status = EXCLUDED.status,
    paid_at = EXCLUDED.paid_at,
    raw_event_json = EXCLUDED.raw_event_json,
    idempotency_key = COALESCE(EXCLUDED.idempotency_key, public.billing_transactions.idempotency_key),
    metadata = COALESCE(public.billing_transactions.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
    updated_at = v_now;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reference', v_reference);
  END IF;

  INSERT INTO public.billing_customers (
    user_id,
    email,
    paystack_customer_code,
    metadata,
    updated_at
  )
  VALUES (
    p_user_id,
    LOWER(TRIM(COALESCE(p_customer_email, ''))),
    CASE WHEN LOWER(TRIM(COALESCE(p_gateway, 'paystack'))) = 'paystack' THEN NULLIF(TRIM(COALESCE(p_customer_code, '')), '') ELSE NULL END,
    jsonb_strip_nulls(jsonb_build_object(
      'gateway', p_gateway,
      'latest_transaction_id', NULLIF(TRIM(COALESCE(p_transaction_id, '')), ''),
      'latest_authorization_code', NULLIF(TRIM(COALESCE(p_authorization_code, '')), '')
    )),
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    email = COALESCE(NULLIF(EXCLUDED.email, ''), public.billing_customers.email),
    paystack_customer_code = COALESCE(EXCLUDED.paystack_customer_code, public.billing_customers.paystack_customer_code),
    metadata = COALESCE(public.billing_customers.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
    updated_at = v_now;

  IF v_status <> 'success' OR v_plan_key IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reference', v_reference);
  END IF;

  SELECT g.ends_at
  INTO v_active_end
  FROM public.entitlement_grants g
  WHERE g.user_id = p_user_id
    AND g.entitlement = 'pro'
    AND g.status = 'active'
    AND g.ends_at >= v_now
  ORDER BY g.ends_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_active_end IS NOT NULL AND v_active_end > v_now THEN
    v_starts_at := v_active_end;
  END IF;
  v_ends_at := v_starts_at + make_interval(days => v_days);

  INSERT INTO public.entitlement_grants (
    user_id,
    entitlement,
    source,
    starts_at,
    ends_at,
    status,
    reason,
    metadata
  )
  VALUES (
    p_user_id,
    'pro',
    COALESCE(NULLIF(TRIM(COALESCE(p_gateway, '')), ''), 'paystack') || ':' || v_charge_method,
    v_starts_at,
    v_ends_at,
    'active',
    'charge.success:' || v_reference,
    jsonb_strip_nulls(COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'reference', v_reference,
      'plan_key', v_plan_key,
      'gateway', p_gateway,
      'transaction_id', NULLIF(TRIM(COALESCE(p_transaction_id, '')), '')
    ))
  )
  RETURNING id INTO v_grant_id;

  IF v_charge_method = 'subscription' THEN
    v_subscription := jsonb_build_object(
      'plan_key', v_plan_key,
      'status', 'active',
      'paystack_subscription_code', NULLIF(TRIM(COALESCE(p_subscription_code, '')), ''),
      'paystack_email_token', NULLIF(TRIM(COALESCE(p_subscription_email_token, '')), ''),
      'starts_at', v_starts_at,
      'ends_at', v_ends_at,
      'cancel_at_period_end', FALSE,
      'metadata', jsonb_strip_nulls(jsonb_build_object(
        'latest_reference', v_reference,
        'gateway', p_gateway,
        'transaction_id', NULLIF(TRIM(COALESCE(p_transaction_id, '')), '')
      ) || COALESCE(p_metadata -> 'subscription_metadata', '{}'::jsonb))
    );
  END IF;

  v_transition := public.apply_plan_transition(
    p_user_id,
    'pro',
    'paid',
    v_ends_at,
    COALESCE(NULLIF(TRIM(COALESCE(p_transition_kind, '')), ''), 'renewal'),
    COALESCE(NULLIF(TRIM(COALESCE(p_gateway, '')), ''), 'paystack') || ':' || v_charge_method,
    'charge.success:' || v_reference,
    p_trace_id,
    jsonb_strip_nulls(COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'reference', v_reference,
      'plan_key', v_plan_key,
      'gateway', p_gateway,
      'transaction_id', NULLIF(TRIM(COALESCE(p_transaction_id, '')), '')
    )),
    v_subscription
  );

  -- public.subscriptions is a removed compatibility table. Keep mirroring only
  -- for installations that still have it, without making it a parse-time
  -- dependency that breaks clean installs or schema lint.
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    EXECUTE $legacy$
      INSERT INTO public.subscriptions (
        user_id,
        status,
        plan,
        gateway,
        transaction_id,
        created_at
      )
      VALUES ($1, 'active', $2, $3, $4, $5)
      ON CONFLICT (transaction_id) DO UPDATE
      SET
        status = EXCLUDED.status,
        plan = EXCLUDED.plan,
        gateway = EXCLUDED.gateway
    $legacy$
    USING
      p_user_id,
      v_plan_key,
      COALESCE(NULLIF(TRIM(COALESCE(p_gateway, '')), ''), 'paystack'),
      COALESCE(NULLIF(TRIM(COALESCE(p_transaction_id, '')), ''), v_reference),
      COALESCE(p_paid_at, v_now);
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'reference', v_reference,
    'grant_id', v_grant_id,
    'starts_at', v_starts_at,
    'ends_at', v_ends_at,
    'transition', v_transition
  );
END;
$$;
