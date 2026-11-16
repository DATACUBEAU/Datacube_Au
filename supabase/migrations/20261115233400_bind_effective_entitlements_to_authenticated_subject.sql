-- Authenticated callers may only resolve their own entitlement snapshot.
-- Trusted service-role requests may resolve a different subject after server-side authorization.
CREATE OR REPLACE FUNCTION public.get_effective_entitlements(p_user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_now TIMESTAMPTZ := now();
  v_promo_end_utc TIMESTAMPTZ := '2026-04-01T23:00:00.000Z'::timestamptz;
  v_profile_tier TEXT := 'free';
  v_billing_enabled BOOLEAN := FALSE;
  v_promo_enabled BOOLEAN := FALSE;
  v_has_paid_pro BOOLEAN := FALSE;
  v_paid_ends_at TIMESTAMPTZ := NULL;
  v_subscription_plan_key TEXT := NULL;
  v_subscription_ends_at TIMESTAMPTZ := NULL;
  v_admin_override_plan TEXT := NULL;
  v_promo_active BOOLEAN := FALSE;
  v_has_pro BOOLEAN := FALSE;
  v_source TEXT := 'none';
  v_plan TEXT := 'free';
  v_promo_content JSONB := '{}'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    p_user_id := v_requester;
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;

    IF p_user_id <> v_requester AND NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT LOWER(COALESCE(tier, 'free'))
  INTO v_profile_tier
  FROM public.au_user_profiles
  WHERE user_id = p_user_id;

  SELECT COALESCE(enabled, FALSE)
  INTO v_billing_enabled
  FROM public.feature_flags
  WHERE key = 'billing_enabled'
  LIMIT 1;

  SELECT COALESCE(enabled, FALSE)
  INTO v_promo_enabled
  FROM public.feature_flags
  WHERE key = 'promo_enabled'
  LIMIT 1;

  SELECT COALESCE(config, '{}'::jsonb)
  INTO v_promo_content
  FROM public.feature_flags
  WHERE key = 'promo_content'
  LIMIT 1;

  BEGIN
    SELECT LOWER(NULLIF(TRIM(admin_override_plan), ''))
    INTO v_admin_override_plan
    FROM public.au_user_entitlements
    WHERE user_id = p_user_id;
  EXCEPTION
    WHEN undefined_column OR undefined_table THEN
      v_admin_override_plan := NULL;
  END;

  BEGIN
    SELECT LOWER(plan_key), ends_at
    INTO v_subscription_plan_key, v_subscription_ends_at
    FROM public.billing_subscriptions
    WHERE user_id = p_user_id
      AND LOWER(status) IN ('active', 'trialing', 'non_renewing')
      AND (ends_at IS NULL OR ends_at >= v_now)
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      v_subscription_plan_key := NULL;
      v_subscription_ends_at := NULL;
  END;

  BEGIN
    SELECT TRUE, ends_at
    INTO v_has_paid_pro, v_paid_ends_at
    FROM public.entitlement_grants
    WHERE user_id = p_user_id
      AND entitlement = 'pro'
      AND status = 'active'
      AND starts_at <= v_now
      AND ends_at >= v_now
    ORDER BY ends_at DESC
    LIMIT 1;
  EXCEPTION
    WHEN undefined_table THEN
      v_has_paid_pro := FALSE;
      v_paid_ends_at := NULL;
  END;

  v_promo_active := COALESCE(v_promo_enabled, FALSE) AND v_now < v_promo_end_utc;

  IF v_admin_override_plan = 'free' THEN
    v_has_pro := FALSE;
    v_source := 'none';
    v_plan := 'free';
    v_paid_ends_at := NULL;
  ELSIF v_admin_override_plan = 'premium' THEN
    v_has_pro := TRUE;
    v_source := 'paid';
    v_plan := 'premium';
    v_paid_ends_at := NULL;
  ELSIF v_admin_override_plan IN ('pro_weekly', 'pro_monthly') THEN
    v_has_pro := TRUE;
    v_source := 'paid';
    v_plan := 'pro';
    v_paid_ends_at := NULL;
  ELSIF v_subscription_plan_key IN ('pro_weekly', 'pro_monthly', 'pro') THEN
    v_has_pro := TRUE;
    v_source := 'paid';
    v_plan := 'pro';
    v_paid_ends_at := v_subscription_ends_at;
  ELSIF v_subscription_plan_key = 'premium' THEN
    v_has_pro := TRUE;
    v_source := 'paid';
    v_plan := 'premium';
    v_paid_ends_at := v_subscription_ends_at;
  ELSIF v_profile_tier = 'admin' THEN
    v_has_pro := TRUE;
    v_source := 'paid';
    v_plan := 'pro';
  ELSIF v_has_paid_pro THEN
    v_has_pro := TRUE;
    v_source := 'paid';
    v_plan := 'pro';
  ELSIF v_promo_active THEN
    v_has_pro := TRUE;
    v_source := 'promo';
    v_plan := 'promo_pro';
  ELSE
    v_has_pro := FALSE;
    v_source := 'none';
    v_plan := 'free';
    v_paid_ends_at := NULL;
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'profile_tier', v_profile_tier,
    'plan', v_plan,
    'has_pro', v_has_pro,
    'entitlement_source', v_source,
    'entitlement_ends_at', v_paid_ends_at,
    'admin_override_plan', v_admin_override_plan,
    'billing_enabled', COALESCE(v_billing_enabled, FALSE),
    'promo_enabled', COALESCE(v_promo_enabled, FALSE),
    'promo_active', v_promo_active,
    'can_access_billing', COALESCE(v_billing_enabled, FALSE) AND NOT v_promo_active,
    'promo_banner_enabled', v_promo_active,
    'promo_content_config', COALESCE(v_promo_content, '{}'::jsonb),
    'promo_ends_at_utc', '2026-04-01T23:00:00.000Z',
    'promo_ends_at_lagos', '2026-04-02T00:00:00+01:00',
    'as_of', v_now
  );
END;
$function$;
