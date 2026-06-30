-- General administrator plan assignment overrides.
--
-- This keeps external billing-provider records immutable and applies an
-- explicit application-level override through public.au_user_entitlements.
--
-- Rollback:
--   ALTER TABLE public.au_user_entitlements DROP CONSTRAINT IF EXISTS au_user_entitlements_admin_override_plan_check;
--   ALTER TABLE public.au_user_entitlements ADD CONSTRAINT au_user_entitlements_admin_override_plan_check
--     CHECK (admin_override_plan IS NULL OR admin_override_plan IN ('free', 'pro_weekly', 'pro_monthly'));
--   ALTER TABLE public.au_user_entitlements ADD CONSTRAINT au_user_entitlements_admin_override_owner_check
--     CHECK (admin_override_plan IS NULL OR user_id = '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid);
--   DROP FUNCTION IF EXISTS public.admin_set_user_plan_override(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT);

BEGIN;

ALTER TABLE public.au_user_entitlements
  ADD COLUMN IF NOT EXISTS admin_override_plan TEXT NULL;

ALTER TABLE public.au_user_entitlements
  DROP CONSTRAINT IF EXISTS au_user_entitlements_admin_override_owner_check;

ALTER TABLE public.au_user_entitlements
  DROP CONSTRAINT IF EXISTS au_user_entitlements_admin_override_plan_check;

ALTER TABLE public.au_user_entitlements
  ADD CONSTRAINT au_user_entitlements_admin_override_plan_check
  CHECK (
    admin_override_plan IS NULL
    OR admin_override_plan IN ('free', 'pro_weekly', 'pro_monthly', 'premium')
  );

ALTER TABLE public.admin_entitlement_override_audit
  DROP CONSTRAINT IF EXISTS admin_entitlement_override_audit_previous_override_plan_check;

ALTER TABLE public.admin_entitlement_override_audit
  DROP CONSTRAINT IF EXISTS admin_entitlement_override_audit_next_override_plan_check;

ALTER TABLE public.admin_entitlement_override_audit
  ADD CONSTRAINT admin_entitlement_override_audit_previous_override_plan_check
  CHECK (
    previous_override_plan IS NULL
    OR previous_override_plan IN ('free', 'pro_weekly', 'pro_monthly', 'premium')
  );

ALTER TABLE public.admin_entitlement_override_audit
  ADD CONSTRAINT admin_entitlement_override_audit_next_override_plan_check
  CHECK (next_override_plan IN ('free', 'pro_weekly', 'pro_monthly', 'premium'));

CREATE OR REPLACE FUNCTION public.admin_set_user_plan_override(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_target_plan TEXT,
  p_previous_effective_plan TEXT DEFAULT NULL,
  p_change_type TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_target_plan TEXT := LOWER(NULLIF(TRIM(p_target_plan), ''));
  v_previous_override TEXT := NULL;
  v_exists BOOLEAN := FALSE;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_actor_or_target' USING ERRCODE = '22023';
  END IF;

  IF v_target_plan = 'pro' THEN
    v_target_plan := 'pro_monthly';
  END IF;

  IF v_target_plan NOT IN ('free', 'pro_monthly', 'premium') THEN
    RAISE EXCEPTION 'invalid_target_plan' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id)
  INTO v_exists;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'target_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT admin_override_plan
  INTO v_previous_override
  FROM public.au_user_entitlements
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  INSERT INTO public.au_user_entitlements (
    user_id,
    plan,
    source,
    expires_at,
    admin_override_plan,
    metadata,
    updated_at
  )
  VALUES (
    p_target_user_id,
    'free',
    'none',
    NULL,
    v_target_plan,
    jsonb_build_object(
      'admin_plan_actor_id', p_actor_user_id,
      'admin_plan_actor_email', p_actor_email,
      'admin_plan_updated_at', v_now,
      'admin_plan_reason', COALESCE(NULLIF(TRIM(p_reason), ''), 'admin_plan_assignment'),
      'admin_plan_request_id', p_request_id
    ),
    v_now
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    admin_override_plan = EXCLUDED.admin_override_plan,
    metadata = COALESCE(public.au_user_entitlements.metadata, '{}'::jsonb)
      || EXCLUDED.metadata
      || jsonb_build_object('previous_admin_override_plan', v_previous_override),
    updated_at = v_now;

  INSERT INTO public.admin_entitlement_override_audit (
    user_id,
    actor_user_id,
    actor_email,
    previous_override_plan,
    next_override_plan,
    reason,
    metadata,
    created_at
  )
  VALUES (
    p_target_user_id,
    p_actor_user_id,
    p_actor_email,
    v_previous_override,
    v_target_plan,
    COALESCE(NULLIF(TRIM(p_reason), ''), 'admin_plan_assignment'),
    jsonb_build_object(
      'previous_effective_plan', p_previous_effective_plan,
      'next_effective_plan', v_target_plan,
      'change_type', p_change_type,
      'request_id', p_request_id,
      'billing_records_preserved', TRUE
    ),
    v_now
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'user_id', p_target_user_id,
    'previous_override_plan', v_previous_override,
    'next_override_plan', v_target_plan,
    'changed', COALESCE(v_previous_override, '') <> v_target_plan,
    'billing_records_preserved', TRUE,
    'updated_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_plan_override(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_user_plan_override(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_effective_entitlements(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF v_role <> 'service_role'
     AND v_requester IS NOT NULL
     AND p_user_id <> v_requester
     AND NOT public.is_conex_admin(v_requester) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
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
$$;

REVOKE ALL ON FUNCTION public.get_effective_entitlements(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_entitlements(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_entitlements(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
