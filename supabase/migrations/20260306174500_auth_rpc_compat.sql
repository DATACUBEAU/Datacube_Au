DROP FUNCTION IF EXISTS public.ensure_user_consistency();

CREATE OR REPLACE FUNCTION public.ensure_user_consistency()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_now TIMESTAMPTZ := now();
  v_profile_tier TEXT := NULL;
  v_plan TEXT := 'free';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('public.au_user_profiles') IS NOT NULL THEN
    SELECT LOWER(COALESCE(tier, ''))
      INTO v_profile_tier
    FROM public.au_user_profiles
    WHERE user_id = v_user_id;

    INSERT INTO public.au_user_profiles (user_id, last_activity_at)
    VALUES (v_user_id, v_now)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF v_profile_tier IN ('admin', 'pro', 'premium', 'weekly', 'monthly', 'paid', 'promo_pro') THEN
    v_plan := 'pro';
  END IF;

  IF to_regclass('public.au_user_entitlements') IS NOT NULL THEN
    INSERT INTO public.au_user_entitlements (user_id, plan, updated_at)
    VALUES (v_user_id, v_plan, v_now)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', v_user_id,
    'plan', v_plan,
    'checked_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_consistency() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_consistency() TO authenticated, service_role;
