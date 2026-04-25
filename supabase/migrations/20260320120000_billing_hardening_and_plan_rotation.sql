BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE public.billing_plans
SET paystack_plan_code = CASE
  WHEN plan_key = 'pro_weekly' THEN 'PLN_h3teb0z285iuyet'
  WHEN plan_key = 'pro_monthly' THEN 'PLN_bo7k3ulauwdhzjl'
  ELSE paystack_plan_code
END,
updated_at = now()
WHERE plan_key IN ('pro_weekly', 'pro_monthly');

CREATE TABLE IF NOT EXISTS public.billing_renewal_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_key TEXT NULL,
  gateway TEXT NOT NULL DEFAULT 'paystack',
  reference TEXT NULL,
  subscription_code TEXT NULL,
  attempt_number INT NOT NULL CHECK (attempt_number > 0),
  failure_kind TEXT NULL,
  status TEXT NOT NULL,
  next_retry_at TIMESTAMPTZ NULL,
  final_failure BOOLEAN NOT NULL DEFAULT FALSE,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_renewal_attempts_user_created
  ON public.billing_renewal_attempts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_renewal_attempts_next_retry
  ON public.billing_renewal_attempts(next_retry_at)
  WHERE next_retry_at IS NOT NULL;

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

  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    INSERT INTO public.subscriptions (
      user_id,
      status,
      plan,
      gateway,
      transaction_id,
      created_at
    )
    VALUES (
      p_user_id,
      'active',
      v_plan_key,
      COALESCE(NULLIF(TRIM(COALESCE(p_gateway, '')), ''), 'paystack'),
      COALESCE(NULLIF(TRIM(COALESCE(p_transaction_id, '')), ''), v_reference),
      COALESCE(p_paid_at, v_now)
    )
    ON CONFLICT (transaction_id) DO UPDATE
    SET
      status = EXCLUDED.status,
      plan = EXCLUDED.plan,
      gateway = EXCLUDED.gateway;
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

CREATE OR REPLACE FUNCTION public.apply_billing_renewal_failure(
  p_user_id UUID,
  p_reference TEXT DEFAULT NULL,
  p_gateway TEXT DEFAULT 'paystack',
  p_plan_key TEXT DEFAULT NULL,
  p_subscription_code TEXT DEFAULT NULL,
  p_attempt_number INT DEFAULT 1,
  p_failure_kind TEXT DEFAULT NULL,
  p_next_retry_at TIMESTAMPTZ DEFAULT NULL,
  p_final_failure BOOLEAN DEFAULT FALSE,
  p_response_json JSONB DEFAULT '{}'::jsonb,
  p_amount_kobo BIGINT DEFAULT 0,
  p_channel TEXT DEFAULT 'subscription',
  p_trace_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_reference TEXT := NULLIF(TRIM(COALESCE(p_reference, '')), '');
  v_plan_key TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_plan_key, '')), ''), 'pro_monthly');
  v_transition JSONB := '{}'::jsonb;
  v_subscription JSONB := jsonb_build_object(
    'plan_key', v_plan_key,
    'status', CASE WHEN p_final_failure THEN 'expired' ELSE 'retrying' END,
    'paystack_subscription_code', NULLIF(TRIM(COALESCE(p_subscription_code, '')), ''),
    'ends_at', CASE WHEN p_final_failure THEN v_now ELSE NULL END,
    'cancel_at_period_end', p_final_failure,
    'metadata', jsonb_strip_nulls(jsonb_build_object(
      'renewal_attempt_count', GREATEST(COALESCE(p_attempt_number, 1), 1),
      'renewal_failure_kind', NULLIF(TRIM(COALESCE(p_failure_kind, '')), ''),
      'renewal_last_failed_at', v_now,
      'renewal_next_retry_at', p_next_retry_at,
      'renewal_final_failure', p_final_failure,
      'renewal_status', CASE WHEN p_final_failure THEN 'failed' ELSE 'retrying' END,
      'renewal_last_gateway_response', COALESCE(p_response_json, '{}'::jsonb)
    ))
  );
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  IF v_reference IS NOT NULL THEN
    INSERT INTO public.billing_transactions (
      user_id,
      reference,
      amount_kobo,
      channel,
      status,
      paid_at,
      raw_event_json,
      metadata,
      updated_at
    )
    VALUES (
      p_user_id,
      v_reference,
      GREATEST(COALESCE(p_amount_kobo, 0), 0),
      COALESCE(NULLIF(TRIM(COALESCE(p_channel, '')), ''), 'subscription'),
      'failed',
      NULL,
      COALESCE(p_response_json, '{}'::jsonb),
      jsonb_strip_nulls(jsonb_build_object(
        'gateway', p_gateway,
        'plan_key', v_plan_key,
        'subscription_code', NULLIF(TRIM(COALESCE(p_subscription_code, '')), '')
      )),
      v_now
    )
    ON CONFLICT (reference) DO UPDATE
    SET
      user_id = COALESCE(EXCLUDED.user_id, public.billing_transactions.user_id),
      amount_kobo = EXCLUDED.amount_kobo,
      channel = EXCLUDED.channel,
      status = EXCLUDED.status,
      raw_event_json = EXCLUDED.raw_event_json,
      metadata = COALESCE(public.billing_transactions.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
      updated_at = v_now;
  END IF;

  INSERT INTO public.billing_renewal_attempts (
    user_id,
    plan_key,
    gateway,
    reference,
    subscription_code,
    attempt_number,
    failure_kind,
    status,
    next_retry_at,
    final_failure,
    response_json
  )
  VALUES (
    p_user_id,
    v_plan_key,
    COALESCE(NULLIF(TRIM(COALESCE(p_gateway, '')), ''), 'paystack'),
    v_reference,
    NULLIF(TRIM(COALESCE(p_subscription_code, '')), ''),
    GREATEST(COALESCE(p_attempt_number, 1), 1),
    NULLIF(TRIM(COALESCE(p_failure_kind, '')), ''),
    CASE WHEN p_final_failure THEN 'failed' ELSE 'retrying' END,
    p_next_retry_at,
    p_final_failure,
    COALESCE(p_response_json, '{}'::jsonb)
  );

  INSERT INTO public.billing_subscriptions (
    user_id,
    plan_key,
    status,
    paystack_subscription_code,
    ends_at,
    cancel_at_period_end,
    metadata,
    updated_at
  )
  VALUES (
    p_user_id,
    v_plan_key,
    CASE WHEN p_final_failure THEN 'expired' ELSE 'retrying' END,
    NULLIF(TRIM(COALESCE(p_subscription_code, '')), ''),
    CASE WHEN p_final_failure THEN v_now ELSE NULL END,
    p_final_failure,
    COALESCE(v_subscription -> 'metadata', '{}'::jsonb),
    v_now
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    plan_key = COALESCE(EXCLUDED.plan_key, public.billing_subscriptions.plan_key),
    status = EXCLUDED.status,
    paystack_subscription_code = COALESCE(EXCLUDED.paystack_subscription_code, public.billing_subscriptions.paystack_subscription_code),
    ends_at = COALESCE(EXCLUDED.ends_at, public.billing_subscriptions.ends_at),
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    metadata = COALESCE(public.billing_subscriptions.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
    updated_at = v_now;

  IF p_final_failure THEN
    UPDATE public.entitlement_grants
    SET
      status = 'expired',
      ends_at = CASE WHEN ends_at > v_now THEN v_now ELSE ends_at END
    WHERE user_id = p_user_id
      AND entitlement = 'pro'
      AND status = 'active';

    v_transition := public.apply_plan_transition(
      p_user_id,
      'free',
      'none',
      NULL,
      'downgrade',
      'billing_renewal',
      'final_renewal_failure',
      p_trace_id,
      jsonb_strip_nulls(jsonb_build_object(
        'gateway', p_gateway,
        'plan_key', v_plan_key,
        'reference', v_reference,
        'failure_kind', NULLIF(TRIM(COALESCE(p_failure_kind, '')), '')
      )),
      v_subscription
    );
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'final_failure', p_final_failure,
    'next_retry_at', p_next_retry_at,
    'transition', v_transition
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_verified_billing_payment(
  UUID, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_verified_billing_payment(
  UUID, TEXT, BIGINT, TEXT, TEXT, TIMESTAMPTZ, JSONB, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.apply_billing_renewal_failure(
  UUID, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ, BOOLEAN, JSONB, BIGINT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.apply_billing_renewal_failure(
  UUID, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ, BOOLEAN, JSONB, BIGINT, TEXT, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
