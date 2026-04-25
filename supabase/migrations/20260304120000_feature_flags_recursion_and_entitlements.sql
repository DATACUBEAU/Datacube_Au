-- Fix recursive feature-flag sync loops and introduce canonical effective entitlements RPC.

CREATE OR REPLACE FUNCTION public.sync_feature_flags_to_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Prevent trigger ping-pong loops.
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'au_feature_flags'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.au_feature_flags WHERE key = OLD.key;
    RETURN OLD;
  END IF;

  INSERT INTO public.au_feature_flags (key, is_enabled, description, updated_at)
  VALUES (
    NEW.key,
    NEW.enabled,
    COALESCE(NEW.description, ''),
    COALESCE(NEW.updated_at, now())
  )
  ON CONFLICT (key) DO UPDATE
  SET is_enabled = EXCLUDED.is_enabled,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  WHERE public.au_feature_flags.is_enabled IS DISTINCT FROM EXCLUDED.is_enabled
     OR public.au_feature_flags.description IS DISTINCT FROM EXCLUDED.description
     OR public.au_feature_flags.updated_at IS DISTINCT FROM EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_flags_to_legacy ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_to_legacy
AFTER INSERT OR UPDATE OR DELETE ON public.feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.sync_feature_flags_to_legacy();

-- Canonical table is public.feature_flags.
-- Drop reverse sync trigger to prevent stack-depth recursion under write contention.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'au_feature_flags'
  ) THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_legacy_feature_flags_to_feature_flags ON public.au_feature_flags';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_feature_flag(
  p_key TEXT,
  p_enabled BOOLEAN,
  p_category TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_scope TEXT DEFAULT 'global',
  p_config JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_admin BOOLEAN := FALSE;
  v_key TEXT := TRIM(COALESCE(p_key, ''));
  v_row public.feature_flags%ROWTYPE;
  v_effective_billing BOOLEAN := FALSE;
BEGIN
  IF v_key = '' THEN
    RAISE EXCEPTION 'flag_key_required' USING ERRCODE = '22023';
  END IF;

  IF v_role = 'service_role' THEN
    v_is_admin := TRUE;
  ELSIF to_regprocedure('public.is_conex_admin(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.is_conex_admin($1)' INTO v_is_admin USING v_uid;
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
  VALUES (
    v_key,
    COALESCE(p_enabled, FALSE),
    COALESCE(NULLIF(TRIM(p_category), ''), 'general'),
    COALESCE(p_description, ''),
    CASE WHEN p_scope IN ('global', 'org', 'user') THEN p_scope ELSE 'global' END,
    COALESCE(p_config, '{}'::jsonb)
  )
  ON CONFLICT (key) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      scope = EXCLUDED.scope,
      config = EXCLUDED.config,
      updated_at = now()
  RETURNING * INTO v_row;

  IF v_key = 'billing_enabled' THEN
    v_effective_billing := COALESCE(v_row.enabled, FALSE);
    IF v_row.enabled THEN
      INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
      VALUES (
        'promo_enabled',
        FALSE,
        'billing',
        'Promo mode switch. When enabled, billing is forced off.',
        'global',
        '{}'::jsonb
      )
      ON CONFLICT (key) DO UPDATE
      SET enabled = FALSE, updated_at = now();
    END IF;
  ELSIF v_key = 'promo_enabled' THEN
    IF v_row.enabled THEN
      INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
      VALUES (
        'billing_enabled',
        FALSE,
        'billing',
        'Master billing/monetization toggle.',
        'global',
        '{}'::jsonb
      )
      ON CONFLICT (key) DO UPDATE
      SET enabled = FALSE, updated_at = now();
      v_effective_billing := FALSE;
    ELSE
      SELECT COALESCE(enabled, FALSE)
      INTO v_effective_billing
      FROM public.feature_flags
      WHERE key = 'billing_enabled'
      LIMIT 1;
    END IF;
  END IF;

  IF v_key IN ('billing_enabled', 'promo_enabled') THEN
    INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
    VALUES (
      'paid_mode_enabled',
      COALESCE(v_effective_billing, FALSE),
      'billing',
      'Mirrors billing_enabled to avoid redundant toggle drift.',
      'global',
      '{}'::jsonb
    )
    ON CONFLICT (key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        description = EXCLUDED.description,
        updated_at = now();
  END IF;

  SELECT *
  INTO v_row
  FROM public.feature_flags
  WHERE key = v_key
  LIMIT 1;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'key', v_row.key,
    'enabled', v_row.enabled,
    'category', v_row.category,
    'description', v_row.description,
    'scope', v_row.scope,
    'org_id', v_row.org_id,
    'user_id', v_row.user_id,
    'config', v_row.config,
    'updated_at', v_row.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO service_role;

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

  IF v_profile_tier = 'admin' THEN
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
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'profile_tier', v_profile_tier,
    'plan', v_plan,
    'has_pro', v_has_pro,
    'entitlement_source', v_source,
    'entitlement_ends_at', v_paid_ends_at,
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
