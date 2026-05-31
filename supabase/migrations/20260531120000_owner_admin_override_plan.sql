-- Protected platform owner account and testing-only entitlement override.
-- Owner: 05ad2f16-b3ce-48eb-bf24-41b407556ffd

BEGIN;

ALTER TABLE public.au_user_entitlements
  ADD COLUMN IF NOT EXISTS admin_override_plan TEXT NULL;

ALTER TABLE public.au_user_entitlements
  DROP CONSTRAINT IF EXISTS au_user_entitlements_admin_override_plan_check;

ALTER TABLE public.au_user_entitlements
  ADD CONSTRAINT au_user_entitlements_admin_override_plan_check
  CHECK (
    admin_override_plan IS NULL
    OR admin_override_plan IN ('free', 'pro_weekly', 'pro_monthly')
  );

ALTER TABLE public.au_user_entitlements
  DROP CONSTRAINT IF EXISTS au_user_entitlements_admin_override_owner_check;

ALTER TABLE public.au_user_entitlements
  ADD CONSTRAINT au_user_entitlements_admin_override_owner_check
  CHECK (
    admin_override_plan IS NULL
    OR user_id = '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid
  );

CREATE INDEX IF NOT EXISTS idx_au_user_entitlements_admin_override_plan
  ON public.au_user_entitlements(admin_override_plan)
  WHERE admin_override_plan IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.admin_entitlement_override_audit (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  actor_user_id UUID NULL,
  actor_email TEXT NULL,
  previous_override_plan TEXT NULL
    CHECK (
      previous_override_plan IS NULL
      OR previous_override_plan IN ('free', 'pro_weekly', 'pro_monthly')
    ),
  next_override_plan TEXT NOT NULL
    CHECK (next_override_plan IN ('free', 'pro_weekly', 'pro_monthly')),
  reason TEXT NOT NULL DEFAULT 'owner_plan_testing',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_entitlement_override_audit_user_created
  ON public.admin_entitlement_override_audit(user_id, created_at DESC);

ALTER TABLE public.admin_entitlement_override_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_entitlement_override_audit_service_role"
  ON public.admin_entitlement_override_audit;
CREATE POLICY "admin_entitlement_override_audit_service_role"
ON public.admin_entitlement_override_audit
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "admin_entitlement_override_audit_admin_select"
  ON public.admin_entitlement_override_audit;
CREATE POLICY "admin_entitlement_override_audit_admin_select"
ON public.admin_entitlement_override_audit
FOR SELECT
TO authenticated
USING (public.is_conex_admin(auth.uid()));

DO $$
BEGIN
  IF to_regclass('public.au_user_profiles') IS NOT NULL
     AND to_regclass('auth.users') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM auth.users
       WHERE id = '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid
     ) THEN
    INSERT INTO public.au_user_profiles (user_id, tier, tier_expires_at)
    VALUES ('05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid, 'admin', NULL)
    ON CONFLICT (user_id)
    DO UPDATE SET
      tier = 'admin',
      tier_expires_at = NULL,
      updated_at = COALESCE(public.au_user_profiles.updated_at, now());
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.au_user_entitlements') IS NOT NULL
     AND to_regclass('auth.users') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM auth.users
       WHERE id = '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid
     ) THEN
    INSERT INTO public.au_user_entitlements (
      user_id,
      plan,
      source,
      expires_at,
      metadata,
      admin_override_plan,
      updated_at
    )
    VALUES (
      '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid,
      'free',
      'none',
      NULL,
      jsonb_build_object('seeded_by', 'owner_admin_override_migration', 'seeded_at', now()),
      'pro_monthly',
      now()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      admin_override_plan = COALESCE(
        public.au_user_entitlements.admin_override_plan,
        'pro_monthly'
      ),
      metadata = COALESCE(public.au_user_entitlements.metadata, '{}'::jsonb)
        || jsonb_build_object('owner_override_migration_seen_at', now()),
      updated_at = now();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_effective_entitlements(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id CONSTANT UUID := '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid;
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

  IF p_user_id = v_owner_id THEN
    BEGIN
      SELECT LOWER(NULLIF(TRIM(admin_override_plan), ''))
      INTO v_admin_override_plan
      FROM public.au_user_entitlements
      WHERE user_id = p_user_id;
    EXCEPTION
      WHEN undefined_column OR undefined_table THEN
        v_admin_override_plan := NULL;
    END;
  END IF;

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

CREATE OR REPLACE FUNCTION public.protect_platform_owner_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_owner_id CONSTANT UUID := '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.id = v_owner_id THEN
    RAISE EXCEPTION 'protected_owner_account_cannot_be_deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.id = v_owner_id
     AND to_jsonb(NEW)->>'deleted_at' IS DISTINCT FROM to_jsonb(OLD)->>'deleted_at' THEN
    RAISE EXCEPTION 'protected_owner_account_cannot_be_deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_protect_platform_owner_auth_user ON auth.users;
    CREATE TRIGGER trg_protect_platform_owner_auth_user
    BEFORE UPDATE OR DELETE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_platform_owner_auth_user();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.protect_platform_owner_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id CONSTANT UUID := '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid;
  v_next_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.user_id = v_owner_id THEN
    RAISE EXCEPTION 'protected_owner_profile_cannot_be_deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id = v_owner_id THEN
    IF NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'protected_owner_user_id_cannot_change'
        USING ERRCODE = '42501';
    END IF;

    v_next_status := LOWER(COALESCE(to_jsonb(NEW)->>'status', 'active'));
    IF v_next_status NOT IN ('active', 'admin') THEN
      RAISE EXCEPTION 'protected_owner_cannot_be_suspended'
        USING ERRCODE = '42501';
    END IF;

    NEW.tier := 'admin';
    NEW.tier_expires_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_platform_owner_profile
  ON public.au_user_profiles;
CREATE TRIGGER trg_protect_platform_owner_profile
BEFORE UPDATE OR DELETE ON public.au_user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_platform_owner_profile();

CREATE OR REPLACE FUNCTION public.protect_platform_owner_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id CONSTANT UUID := '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid;
BEGIN
  IF TG_OP = 'DELETE' AND OLD.user_id = v_owner_id THEN
    RAISE EXCEPTION 'protected_owner_entitlement_cannot_be_deleted'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.user_id = v_owner_id THEN
    IF NEW.admin_override_plan IS NULL THEN
      RAISE EXCEPTION 'protected_owner_admin_override_required'
        USING ERRCODE = '42501';
    END IF;
    NEW.plan := 'free';
    NEW.source := 'none';
    NEW.expires_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id = v_owner_id THEN
    IF NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'protected_owner_user_id_cannot_change'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.admin_override_plan IS NULL THEN
      RAISE EXCEPTION 'protected_owner_admin_override_required'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.plan IS DISTINCT FROM OLD.plan
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'protected_owner_entitlement_base_fields_cannot_change'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_platform_owner_entitlement
  ON public.au_user_entitlements;
CREATE TRIGGER trg_protect_platform_owner_entitlement
BEFORE INSERT OR UPDATE OR DELETE ON public.au_user_entitlements
FOR EACH ROW
EXECUTE FUNCTION public.protect_platform_owner_entitlement();

CREATE OR REPLACE FUNCTION public.protect_platform_owner_row_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id CONSTANT TEXT := '05ad2f16-b3ce-48eb-bf24-41b407556ffd';
  v_old JSONB := to_jsonb(OLD);
BEGIN
  IF v_old->>'user_id' = v_owner_id
     OR v_old->>'owner_id' = v_owner_id
     OR v_old->>'id' = v_owner_id THEN
    RAISE EXCEPTION 'protected_owner_row_cannot_be_deleted'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'au_documents',
    'au_document_chunks',
    'au_worker_jobs',
    'au_upload_jobs',
    'au_upload_audit_log',
    'au_feature_outputs',
    'au_practice_attempts',
    'au_answer_cache',
    'au_messages',
    'au_direct_messages',
    'au_sessions',
    'au_user_preferences',
    'au_user_feedback',
    'au_feedback',
    'au_events',
    'au_user_activity',
    'au_idempotency',
    'au_request_idempotency',
    'au_quota_windows',
    'au_model_usage',
    'ai_routing_audit',
    'memory_summaries',
    'usage_counters',
    'usage_totals',
    'au_plan_transitions',
    'admin_access_logs'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = v_table
           AND column_name IN ('user_id', 'owner_id', 'id')
       ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_protect_platform_owner_delete ON public.%I',
        v_table
      );
      EXECUTE format(
        'CREATE TRIGGER trg_protect_platform_owner_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_platform_owner_row_delete()',
        v_table
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.protect_platform_owner_billing_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id CONSTANT TEXT := '05ad2f16-b3ce-48eb-bf24-41b407556ffd';
  v_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  IF v_row->>'user_id' = v_owner_id THEN
    RAISE EXCEPTION 'protected_owner_billing_rows_are_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'billing_customers',
    'billing_subscriptions',
    'billing_transactions',
    'billing_cancellation_feedback',
    'billing_webhook_events',
    'entitlement_grants',
    'entitlement_audit'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = v_table
           AND column_name = 'user_id'
       ) THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_protect_platform_owner_billing_row ON public.%I',
        v_table
      );
      EXECUTE format(
        'CREATE TRIGGER trg_protect_platform_owner_billing_row BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_platform_owner_billing_row()',
        v_table
      );
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
