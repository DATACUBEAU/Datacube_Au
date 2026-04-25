-- Fix apply_plan_transition by removing non-existent jsonb_object_length function
-- 20260307180000_fix_plan_transition_rpc.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_plan_transition(
  p_user_id UUID,
  p_target_plan TEXT,
  p_entitlement_source TEXT DEFAULT 'none',
  p_entitlement_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_transition_kind TEXT DEFAULT 'sync',
  p_transition_source TEXT DEFAULT 'system',
  p_reason TEXT DEFAULT NULL,
  p_trace_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_subscription JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_plan TEXT := LOWER(TRIM(COALESCE(p_target_plan, 'free')));
  v_target_source TEXT := LOWER(TRIM(COALESCE(p_entitlement_source, 'none')));
  v_previous_plan TEXT := 'free';
  v_previous_source TEXT := 'none';
  v_previous_expires_at TIMESTAMPTZ := NULL;
  v_previous_days INT := 14;
  v_target_days INT := 14;
  v_transition_kind TEXT := LOWER(TRIM(COALESCE(p_transition_kind, 'sync')));
  v_trace_id TEXT := NULLIF(TRIM(COALESCE(p_trace_id, '')), '');
  v_documents_updated INT := 0;
  v_subscription JSONB := CASE
    WHEN jsonb_typeof(COALESCE(p_subscription, '{}'::jsonb)) = 'object' THEN COALESCE(p_subscription, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  IF v_trace_id IS NULL THEN
    v_trace_id := gen_random_uuid()::text;
  END IF;

  IF v_target_plan NOT IN ('free', 'pro', 'premium') THEN
    v_target_plan := 'free';
  END IF;

  IF v_target_source NOT IN ('paid', 'promo', 'none') THEN
    v_target_source := 'none';
  END IF;

  IF v_target_source = 'promo' AND v_target_plan = 'free' THEN
    v_target_plan := 'pro';
  END IF;

  SELECT
    CASE
      WHEN LOWER(COALESCE(e.plan, 'free')) IN ('premium') THEN 'premium'
      WHEN LOWER(COALESCE(e.plan, 'free')) IN ('pro', 'promo_pro', 'admin', 'weekly', 'monthly', 'paid') THEN 'pro'
      ELSE 'free'
    END,
    CASE
      WHEN LOWER(COALESCE(e.source, 'none')) IN ('paid', 'promo') THEN LOWER(COALESCE(e.source, 'none'))
      ELSE 'none'
    END,
    e.expires_at
  INTO v_previous_plan, v_previous_source, v_previous_expires_at
  FROM public.au_user_entitlements e
  WHERE e.user_id = p_user_id;

  IF NOT FOUND THEN
    SELECT
      CASE
        WHEN LOWER(COALESCE(p.tier, 'free')) = 'premium' THEN 'premium'
        WHEN LOWER(COALESCE(p.tier, 'free')) IN ('pro', 'weekly', 'monthly', 'paid') THEN 'pro'
        ELSE 'free'
      END,
      CASE
        WHEN LOWER(COALESCE(p.tier, 'free')) IN ('premium', 'pro', 'weekly', 'monthly', 'paid') THEN 'paid'
        ELSE 'none'
      END,
      p.tier_expires_at
    INTO v_previous_plan, v_previous_source, v_previous_expires_at
    FROM public.au_user_profiles p
    WHERE p.user_id = p_user_id;
  END IF;

  v_previous_days := public.resolve_plan_expiration_days(v_previous_plan, v_previous_source);
  v_target_days := public.resolve_plan_expiration_days(v_target_plan, v_target_source);

  IF v_previous_plan = v_target_plan
    AND v_previous_source = v_target_source
    AND COALESCE(v_previous_expires_at, 'epoch'::timestamptz) = COALESCE(p_entitlement_expires_at, 'epoch'::timestamptz)
    AND (v_subscription IS NULL OR v_subscription = '{}'::jsonb) THEN
    RETURN jsonb_build_object(
      'changed', false,
      'user_id', p_user_id,
      'previous_plan', v_previous_plan,
      'plan', v_target_plan,
      'previous_entitlement_source', v_previous_source,
      'entitlement_source', v_target_source,
      'previous_expires_at', v_previous_expires_at,
      'expires_at', p_entitlement_expires_at,
      'documents_updated', 0,
      'trace_id', v_trace_id
    );
  END IF;

  INSERT INTO public.au_user_entitlements (user_id, plan, source, expires_at, metadata, updated_at)
  VALUES (
    p_user_id,
    v_target_plan,
    v_target_source,
    p_entitlement_expires_at,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'last_transition_source', p_transition_source,
      'last_transition_reason', p_reason,
      'last_transition_kind', v_transition_kind,
      'last_transition_trace_id', v_trace_id,
      'current_expiration_days', v_target_days
    ),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    plan = EXCLUDED.plan,
    source = EXCLUDED.source,
    expires_at = EXCLUDED.expires_at,
    metadata = COALESCE(public.au_user_entitlements.metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'last_transition_source', p_transition_source,
      'last_transition_reason', p_reason,
      'last_transition_kind', v_transition_kind,
      'last_transition_trace_id', v_trace_id,
      'current_expiration_days', v_target_days
    ),
    updated_at = now();

  INSERT INTO public.au_user_profiles (user_id, tier, tier_expires_at)
  VALUES (
    p_user_id,
    CASE
      WHEN v_target_plan = 'premium' THEN 'premium'
      WHEN v_target_plan = 'free' THEN 'free'
      ELSE 'pro'
    END,
    p_entitlement_expires_at
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    tier = EXCLUDED.tier,
    tier_expires_at = EXCLUDED.tier_expires_at;

  IF (v_subscription IS NOT NULL AND v_subscription <> '{}'::jsonb) AND to_regclass('public.billing_subscriptions') IS NOT NULL THEN
    INSERT INTO public.billing_subscriptions (
      user_id,
      plan_key,
      status,
      paystack_subscription_code,
      paystack_email_token,
      starts_at,
      ends_at,
      cancel_at_period_end,
      metadata
    )
    VALUES (
      p_user_id,
      NULLIF(v_subscription ->> 'plan_key', ''),
      COALESCE(NULLIF(v_subscription ->> 'status', ''), 'active'),
      NULLIF(v_subscription ->> 'paystack_subscription_code', ''),
      NULLIF(v_subscription ->> 'paystack_email_token', ''),
      NULLIF(v_subscription ->> 'starts_at', '')::timestamptz,
      NULLIF(v_subscription ->> 'ends_at', '')::timestamptz,
      COALESCE((v_subscription ->> 'cancel_at_period_end')::boolean, FALSE),
      COALESCE(v_subscription -> 'metadata', '{}'::jsonb)
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
      plan_key = COALESCE(EXCLUDED.plan_key, public.billing_subscriptions.plan_key),
      status = COALESCE(EXCLUDED.status, public.billing_subscriptions.status),
      paystack_subscription_code = COALESCE(EXCLUDED.paystack_subscription_code, public.billing_subscriptions.paystack_subscription_code),
      paystack_email_token = COALESCE(EXCLUDED.paystack_email_token, public.billing_subscriptions.paystack_email_token),
      starts_at = COALESCE(EXCLUDED.starts_at, public.billing_subscriptions.starts_at),
      ends_at = COALESCE(EXCLUDED.ends_at, public.billing_subscriptions.ends_at),
      cancel_at_period_end = COALESCE(EXCLUDED.cancel_at_period_end, public.billing_subscriptions.cancel_at_period_end),
      metadata = COALESCE(public.billing_subscriptions.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
      updated_at = now();
  END IF;

  WITH updated_roots AS (
    UPDATE public.au_documents d
    SET expires_at = CASE
      WHEN d.expires_at IS NULL OR d.expires_at <= now() THEN now() + make_interval(days => v_target_days)
      WHEN v_previous_days = v_target_days THEN d.expires_at
      ELSE now() + make_interval(
        secs => GREATEST(
          1,
          ROUND(
            GREATEST(EXTRACT(EPOCH FROM (d.expires_at - now())), 0)
            / GREATEST(v_previous_days * 86400, 1)
            * (v_target_days * 86400)
          )::INT
        )
      )
    END
    WHERE (d.owner_id = p_user_id OR d.user_id = p_user_id)
      AND COALESCE(d.parent_id, d.parent_document_id) IS NULL
    RETURNING d.id
  ),
  updated_children AS (
    UPDATE public.au_documents child
    SET expires_at = parent.expires_at
    FROM public.au_documents parent
    WHERE (child.owner_id = p_user_id OR child.user_id = p_user_id)
      AND (child.parent_id = parent.id OR child.parent_document_id = parent.id)
      AND parent.expires_at IS NOT NULL
    RETURNING child.id
  )
  SELECT
    COALESCE((SELECT COUNT(*) FROM updated_roots), 0)
    + COALESCE((SELECT COUNT(*) FROM updated_children), 0)
  INTO v_documents_updated;

  INSERT INTO public.au_plan_transitions (
    user_id,
    from_plan,
    to_plan,
    from_entitlement_source,
    to_entitlement_source,
    from_retention_days,
    to_retention_days,
    before_expires_at,
    after_expires_at,
    transition_kind,
    source,
    reason,
    trace_id,
    metadata
  )
  VALUES (
    p_user_id,
    v_previous_plan,
    v_target_plan,
    v_previous_source,
    v_target_source,
    v_previous_days,
    v_target_days,
    v_previous_expires_at,
    p_entitlement_expires_at,
    v_transition_kind,
    p_transition_source,
    p_reason,
    v_trace_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );

  INSERT INTO public.entitlement_audit (
    user_id,
    action,
    before_json,
    after_json,
    source,
    trace_id
  )
  VALUES (
    p_user_id,
    'plan_transition',
    jsonb_build_object(
      'plan', v_previous_plan,
      'entitlement_source', v_previous_source,
      'expires_at', v_previous_expires_at,
      'retention_days', v_previous_days
    ),
    jsonb_build_object(
      'plan', v_target_plan,
      'entitlement_source', v_target_source,
      'expires_at', p_entitlement_expires_at,
      'retention_days', v_target_days,
      'documents_updated', v_documents_updated
    ),
    p_transition_source,
    v_trace_id
  );

  RETURN jsonb_build_object(
    'changed', true,
    'user_id', p_user_id,
    'previous_plan', v_previous_plan,
    'plan', v_target_plan,
    'previous_entitlement_source', v_previous_source,
    'entitlement_source', v_target_source,
    'previous_expires_at', v_previous_expires_at,
    'expires_at', p_entitlement_expires_at,
    'documents_updated', v_documents_updated,
    'trace_id', v_trace_id
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
