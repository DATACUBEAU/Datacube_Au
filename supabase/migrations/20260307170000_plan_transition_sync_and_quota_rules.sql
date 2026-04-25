BEGIN;

ALTER TABLE public.au_plan_metadata
  ADD COLUMN IF NOT EXISTS retention_days INT NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS expiration_days INT NOT NULL DEFAULT 14;

ALTER TABLE public.au_user_entitlements
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.au_user_entitlements
SET source = COALESCE(NULLIF(LOWER(TRIM(source)), ''), 'none')
WHERE source IS NULL
   OR TRIM(source) = '';

ALTER TABLE public.au_user_entitlements
  ALTER COLUMN source SET DEFAULT 'none';

ALTER TABLE public.au_user_entitlements
  ALTER COLUMN source SET NOT NULL;

ALTER TABLE public.au_plan_limits
  ALTER COLUMN exams_reset_every_days SET DEFAULT 0;

UPDATE public.au_plan_limits
SET
  max_tokens_total = CASE
    WHEN plan = 'free' THEN 4000
    WHEN plan = 'pro' THEN 18000
    WHEN plan = 'premium' THEN 45000
    ELSE max_tokens_total
  END,
  exams_reset_every_days = 0,
  updated_at = now()
WHERE plan IN ('free', 'pro', 'premium');

UPDATE public.au_plan_metadata
SET
  retention_days = CASE
    WHEN plan = 'pro' THEN 30
    WHEN plan = 'premium' THEN 30
    ELSE 14
  END,
  expiration_days = CASE
    WHEN plan = 'pro' THEN 30
    WHEN plan = 'premium' THEN 30
    ELSE 14
  END,
  updated_at = now()
WHERE plan IN ('free', 'pro', 'premium');

CREATE TABLE IF NOT EXISTS public.au_plan_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_plan TEXT NOT NULL,
  to_plan TEXT NOT NULL,
  from_entitlement_source TEXT NOT NULL DEFAULT 'none',
  to_entitlement_source TEXT NOT NULL DEFAULT 'none',
  from_retention_days INT NOT NULL,
  to_retention_days INT NOT NULL,
  before_expires_at TIMESTAMPTZ NULL,
  after_expires_at TIMESTAMPTZ NULL,
  transition_kind TEXT NOT NULL DEFAULT 'sync',
  source TEXT NOT NULL DEFAULT 'system',
  reason TEXT NULL,
  trace_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_au_plan_transitions_user_created
  ON public.au_plan_transitions(user_id, created_at DESC);

ALTER TABLE public.au_plan_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "au_plan_transitions_service_role" ON public.au_plan_transitions;
CREATE POLICY "au_plan_transitions_service_role"
ON public.au_plan_transitions
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "au_plan_transitions_select_own" ON public.au_plan_transitions;
CREATE POLICY "au_plan_transitions_select_own"
ON public.au_plan_transitions
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_conex_admin(auth.uid()));

GRANT SELECT ON public.au_plan_transitions TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_plan_expiration_days(
  p_plan TEXT,
  p_entitlement_source TEXT DEFAULT 'none'
)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_plan TEXT := LOWER(TRIM(COALESCE(p_plan, 'free')));
  v_source TEXT := LOWER(TRIM(COALESCE(p_entitlement_source, 'none')));
BEGIN
  IF v_source = 'promo' THEN
    RETURN 14;
  END IF;

  IF v_plan IN ('pro', 'premium', 'promo_pro', 'admin', 'weekly', 'monthly', 'paid') THEN
    RETURN 30;
  END IF;

  RETURN 14;
END;
$$;

CREATE OR REPLACE FUNCTION public.quota_window_bounds(
  p_reset_every_days INT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE(window_start TIMESTAMPTZ, window_end TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_days INT := GREATEST(COALESCE(p_reset_every_days, 0), 0);
  v_utc_midnight TIMESTAMPTZ;
  v_epoch_day BIGINT;
  v_window_start_day BIGINT;
BEGIN
  IF v_days <= 0 THEN
    window_start := '1970-01-01T00:00:00.000Z'::timestamptz;
    window_end := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_utc_midnight := date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_epoch_day := FLOOR(EXTRACT(EPOCH FROM v_utc_midnight) / 86400);
  v_window_start_day := v_epoch_day - MOD(v_epoch_day, v_days);

  window_start := to_timestamp(v_window_start_day * 86400);
  window_end := to_timestamp((v_window_start_day + v_days) * 86400);
  RETURN NEXT;
END;
$$;

WITH active_paid AS (
  SELECT DISTINCT ON (g.user_id)
    g.user_id,
    g.ends_at
  FROM public.entitlement_grants g
  WHERE g.entitlement = 'pro'
    AND g.status = 'active'
    AND g.starts_at <= now()
    AND g.ends_at >= now()
  ORDER BY g.user_id, g.ends_at DESC
)
INSERT INTO public.au_user_entitlements (user_id, plan, source, expires_at, metadata, updated_at)
SELECT
  active_paid.user_id,
  'pro',
  'paid',
  active_paid.ends_at,
  jsonb_build_object('synced_from', 'entitlement_grants', 'synced_at', now()),
  now()
FROM active_paid
ON CONFLICT (user_id) DO UPDATE
SET
  plan = 'pro',
  source = 'paid',
  expires_at = EXCLUDED.expires_at,
  metadata = COALESCE(public.au_user_entitlements.metadata, '{}'::jsonb) || jsonb_build_object('synced_from', 'entitlement_grants', 'synced_at', now()),
  updated_at = now();

INSERT INTO public.au_user_entitlements (user_id, plan, source, expires_at, metadata, updated_at)
SELECT
  p.user_id,
  CASE
    WHEN LOWER(COALESCE(p.tier, '')) = 'premium' THEN 'premium'
    WHEN LOWER(COALESCE(p.tier, '')) IN ('pro', 'weekly', 'monthly', 'paid') THEN 'pro'
    ELSE 'free'
  END,
  CASE
    WHEN LOWER(COALESCE(p.tier, '')) IN ('premium', 'pro', 'weekly', 'monthly', 'paid') THEN 'paid'
    ELSE 'none'
  END,
  p.tier_expires_at,
  jsonb_build_object('synced_from', 'au_user_profiles', 'synced_at', now()),
  now()
FROM public.au_user_profiles p
WHERE p.user_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE
SET
  plan = CASE
    WHEN public.au_user_entitlements.source = 'paid' THEN public.au_user_entitlements.plan
    ELSE EXCLUDED.plan
  END,
  source = CASE
    WHEN public.au_user_entitlements.source = 'paid' THEN public.au_user_entitlements.source
    ELSE EXCLUDED.source
  END,
  expires_at = CASE
    WHEN public.au_user_entitlements.source = 'paid' THEN public.au_user_entitlements.expires_at
    ELSE EXCLUDED.expires_at
  END,
  metadata = COALESCE(public.au_user_entitlements.metadata, '{}'::jsonb) || jsonb_build_object('synced_from', 'au_user_profiles', 'synced_at', now()),
  updated_at = now();

WITH paid_users AS (
  SELECT DISTINCT user_id
  FROM public.entitlement_grants
  WHERE entitlement = 'pro'
    AND status = 'active'
    AND starts_at <= now()
    AND ends_at >= now()
)
UPDATE public.au_documents d
SET expires_at = GREATEST(
  COALESCE(d.expires_at, COALESCE(d.created_at, now()) + interval '30 days'),
  COALESCE(d.created_at, now()) + interval '30 days'
)
WHERE COALESCE(d.parent_id, d.parent_document_id) IS NULL
  AND (
    d.owner_id IN (SELECT user_id FROM paid_users)
    OR d.user_id IN (SELECT user_id FROM paid_users)
  );

UPDATE public.au_documents d
SET expires_at = COALESCE(d.expires_at, COALESCE(d.created_at, now()) + interval '14 days')
WHERE COALESCE(d.parent_id, d.parent_document_id) IS NULL;

UPDATE public.au_documents child
SET expires_at = parent.expires_at
FROM public.au_documents parent
WHERE (child.parent_id = parent.id OR child.parent_document_id = parent.id)
  AND parent.expires_at IS NOT NULL;

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

REVOKE ALL ON FUNCTION public.apply_plan_transition(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_plan_transition(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.get_effective_limits(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_plan TEXT := 'free';
  v_entitlement_source TEXT := 'none';
  v_expires_at TIMESTAMPTZ := NULL;
  v_retention_days INT := 14;
  v_limits RECORD;
  v_limits_json JSONB := '{}'::jsonb;
  v_tokens_start TIMESTAMPTZ;
  v_tokens_end TIMESTAMPTZ;
  v_chats_start TIMESTAMPTZ;
  v_chats_end TIMESTAMPTZ;
  v_exams_start TIMESTAMPTZ;
  v_exams_end TIMESTAMPTZ;
  v_docs_count BIGINT := 0;
  v_storage_bytes BIGINT := 0;
  v_uploads_count BIGINT := 0;
  v_chats_used BIGINT := 0;
  v_exams_used BIGINT := 0;
  v_tokens_used BIGINT := 0;
  v_storage_mb BIGINT := 0;
  v_reset_at TIMESTAMPTZ := NULL;
  v_promo_enabled BOOLEAN := FALSE;
  v_promo_end_utc TIMESTAMPTZ := '2026-04-01T23:00:00.000Z'::timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    p_user_id := v_requester;
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF v_requester IS NOT NULL AND p_user_id <> v_requester AND NOT public.is_conex_admin(v_requester) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  BEGIN
    SELECT
      CASE
        WHEN LOWER(COALESCE(e.plan, 'free')) = 'premium' THEN 'premium'
        WHEN LOWER(COALESCE(e.plan, 'free')) IN ('pro', 'promo_pro', 'admin', 'weekly', 'monthly', 'paid') THEN 'pro'
        ELSE 'free'
      END,
      CASE
        WHEN LOWER(COALESCE(e.source, 'none')) IN ('paid', 'promo') THEN LOWER(COALESCE(e.source, 'none'))
        ELSE 'none'
      END,
      e.expires_at
    INTO v_plan, v_entitlement_source, v_expires_at
    FROM public.au_user_entitlements e
    WHERE e.user_id = p_user_id;
  EXCEPTION WHEN undefined_column THEN
    v_plan := 'free';
    v_entitlement_source := 'none';
    v_expires_at := NULL;
  END;

  IF v_plan = 'free' AND v_entitlement_source = 'none' THEN
    IF EXISTS (
      SELECT 1
      FROM public.entitlement_grants g
      WHERE g.user_id = p_user_id
        AND g.entitlement = 'pro'
        AND g.status = 'active'
        AND g.starts_at <= now()
        AND g.ends_at >= now()
    ) THEN
      v_plan := 'pro';
      v_entitlement_source := 'paid';
      SELECT g.ends_at
      INTO v_expires_at
      FROM public.entitlement_grants g
      WHERE g.user_id = p_user_id
        AND g.entitlement = 'pro'
        AND g.status = 'active'
        AND g.starts_at <= now()
        AND g.ends_at >= now()
      ORDER BY g.ends_at DESC
      LIMIT 1;
    ELSE
      SELECT COALESCE(enabled, FALSE)
      INTO v_promo_enabled
      FROM public.feature_flags
      WHERE key = 'promo_enabled'
      LIMIT 1;

      IF v_promo_enabled AND now() < v_promo_end_utc THEN
        v_plan := 'pro';
        v_entitlement_source := 'promo';
        v_expires_at := v_promo_end_utc;
      ELSE
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
        INTO v_plan, v_entitlement_source, v_expires_at
        FROM public.au_user_profiles p
        WHERE p.user_id = p_user_id;
      END IF;
    END IF;
  END IF;

  v_retention_days := public.resolve_plan_expiration_days(v_plan, v_entitlement_source);

  SELECT *
  INTO v_limits
  FROM public.au_plan_limits
  WHERE plan = v_plan;

  IF NOT FOUND THEN
    SELECT *
    INTO v_limits
    FROM public.au_plan_limits
    WHERE plan = 'free';
  END IF;

  IF NOT FOUND THEN
    v_limits_json := jsonb_build_object(
      'max_file_size_mb', 50,
      'max_file_mb', 50,
      'max_uploads_total', 50,
      'max_documents_total', 50,
      'max_docs_total', 50,
      'max_chats_total', 3000,
      'max_exams_total', 10,
      'max_tokens_total', 4000,
      'max_storage_mb', 2000,
      'max_concurrent_jobs', 1,
      'max_jobs_concurrent', 1,
      'tokens_reset_every_days', 1,
      'chats_reset_every_days', 1,
      'uploads_reset_every_days', 0,
      'documents_reset_every_days', 0,
      'exams_reset_every_days', 0,
      'storage_reset_every_days', 0
    );
  ELSE
    v_limits_json := jsonb_build_object(
      'max_file_size_mb', v_limits.max_file_size_mb,
      'max_file_mb', v_limits.max_file_size_mb,
      'max_uploads_total', v_limits.max_uploads_total,
      'max_documents_total', v_limits.max_documents_total,
      'max_docs_total', v_limits.max_documents_total,
      'max_chats_total', v_limits.max_chats_total,
      'max_exams_total', v_limits.max_exams_total,
      'max_tokens_total', v_limits.max_tokens_total,
      'max_storage_mb', v_limits.max_storage_mb,
      'max_concurrent_jobs', v_limits.max_concurrent_jobs,
      'max_jobs_concurrent', v_limits.max_concurrent_jobs,
      'tokens_reset_every_days', v_limits.tokens_reset_every_days,
      'chats_reset_every_days', v_limits.chats_reset_every_days,
      'uploads_reset_every_days', v_limits.uploads_reset_every_days,
      'documents_reset_every_days', v_limits.documents_reset_every_days,
      'exams_reset_every_days', v_limits.exams_reset_every_days,
      'storage_reset_every_days', v_limits.storage_reset_every_days
    );
  END IF;

  SELECT window_start, window_end
  INTO v_tokens_start, v_tokens_end
  FROM public.quota_window_bounds(COALESCE((v_limits_json ->> 'tokens_reset_every_days')::INT, 1), now());

  SELECT window_start, window_end
  INTO v_chats_start, v_chats_end
  FROM public.quota_window_bounds(COALESCE((v_limits_json ->> 'chats_reset_every_days')::INT, 1), now());

  SELECT window_start, window_end
  INTO v_exams_start, v_exams_end
  FROM public.quota_window_bounds(COALESCE((v_limits_json ->> 'exams_reset_every_days')::INT, 0), now());

  BEGIN
    SELECT COUNT(*), COALESCE(SUM(file_size_bytes), 0)
    INTO v_docs_count, v_storage_bytes
    FROM public.au_documents d
    WHERE d.owner_id = p_user_id OR d.user_id = p_user_id;
  EXCEPTION WHEN undefined_column THEN
    SELECT COUNT(*), COALESCE(SUM(file_size_bytes), 0)
    INTO v_docs_count, v_storage_bytes
    FROM public.au_documents d
    WHERE d.user_id = p_user_id;
  END;

  v_uploads_count := v_docs_count;
  v_storage_mb := CEIL(COALESCE(v_storage_bytes, 0)::NUMERIC / 1048576.0);

  IF to_regclass('public.au_messages') IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_chats_used
    FROM public.au_messages m
    WHERE m.user_id = p_user_id
      AND m.created_at >= v_chats_start
      AND (v_chats_end IS NULL OR m.created_at < v_chats_end);
  END IF;

  IF to_regclass('public.au_feature_outputs') IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_exams_used
    FROM public.au_feature_outputs o
    WHERE o.user_id = p_user_id
      AND o.feature IN ('exam_prediction', 'practice_exam_generation', 'practice_exam_generation_pack2')
      AND o.created_at >= v_exams_start
      AND (v_exams_end IS NULL OR o.created_at < v_exams_end);
  END IF;

  IF to_regclass('public.au_model_usage') IS NOT NULL THEN
    SELECT COALESCE(SUM(total_tokens), 0)
    INTO v_tokens_used
    FROM public.au_model_usage u
    WHERE u.user_id = p_user_id
      AND u.created_at >= v_tokens_start
      AND (v_tokens_end IS NULL OR u.created_at < v_tokens_end);
  END IF;

  v_reset_at := COALESCE(v_tokens_end, v_chats_end);

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'plan', v_plan,
    'entitlement_source', v_entitlement_source,
    'retention_days', v_retention_days,
    'limits', v_limits_json,
    'usage', jsonb_build_object(
      'today', jsonb_build_object(
        'used_chats', v_chats_used,
        'messages_count', v_chats_used,
        'used_uploads', v_uploads_count,
        'uploads_count', v_uploads_count,
        'used_documents', v_docs_count,
        'documents_count', v_docs_count,
        'used_exams', v_exams_used,
        'exams_count', v_exams_used,
        'used_tokens', v_tokens_used,
        'tokens_used', v_tokens_used
      ),
      'total', jsonb_build_object(
        'used_chats', v_chats_used,
        'messages_count', v_chats_used,
        'used_uploads', v_uploads_count,
        'uploads_count', v_uploads_count,
        'used_documents', v_docs_count,
        'documents_count', v_docs_count,
        'used_exams', v_exams_used,
        'exams_count', v_exams_used,
        'used_tokens', v_tokens_used,
        'tokens_used', v_tokens_used,
        'used_storage_mb', v_storage_mb,
        'uploaded_mb', v_storage_mb
      ),
      'reset_at', v_reset_at
    ),
    'reset_at', v_reset_at,
    'as_of', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_retention_data(p_dry_run BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN := TRUE;
  v_signed_out_docs BIGINT := 0;
  v_expired_docs BIGINT := 0;
BEGIN
  SELECT COALESCE(enabled, TRUE) INTO v_enabled
  FROM public.feature_flags
  WHERE key = 'retention.enforcement.enabled'
  LIMIT 1;

  IF v_enabled IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'retention_enforcement_disabled');
  END IF;

  IF p_dry_run THEN
    SELECT COUNT(*) INTO v_signed_out_docs
    FROM public.au_documents d
    WHERE d.owner_id IN (
      SELECT p.user_id
      FROM public.au_user_profiles p
      WHERE p.last_sign_out_at IS NOT NULL
        AND p.last_sign_out_at < now() - interval '7 days'
        AND COALESCE(p.last_sign_in_at, '1970-01-01'::timestamptz) <= p.last_sign_out_at
    );

    SELECT COUNT(*) INTO v_expired_docs
    FROM public.au_documents d
    WHERE d.expires_at IS NOT NULL
      AND d.expires_at < now()
      AND d.owner_id NOT IN (
        SELECT p.user_id
        FROM public.au_user_profiles p
        WHERE p.last_sign_out_at IS NOT NULL
          AND p.last_sign_out_at < now() - interval '7 days'
          AND COALESCE(p.last_sign_in_at, '1970-01-01'::timestamptz) <= p.last_sign_out_at
      );

    RETURN jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'signed_out_docs', COALESCE(v_signed_out_docs, 0),
      'expired_docs', COALESCE(v_expired_docs, 0)
    );
  END IF;

  WITH deleted AS (
    DELETE FROM public.au_documents d
    WHERE d.owner_id IN (
      SELECT p.user_id
      FROM public.au_user_profiles p
      WHERE p.last_sign_out_at IS NOT NULL
        AND p.last_sign_out_at < now() - interval '7 days'
        AND COALESCE(p.last_sign_in_at, '1970-01-01'::timestamptz) <= p.last_sign_out_at
    )
    RETURNING d.id
  )
  SELECT COUNT(*) INTO v_signed_out_docs FROM deleted;

  WITH deleted AS (
    DELETE FROM public.au_documents d
    WHERE d.expires_at IS NOT NULL
      AND d.expires_at < now()
    RETURNING d.id
  )
  SELECT COUNT(*) INTO v_expired_docs FROM deleted;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'signed_out_docs_deleted', COALESCE(v_signed_out_docs, 0),
    'expired_docs_deleted', COALESCE(v_expired_docs, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_retention_data(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_retention_data(BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_limits(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_limits(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
