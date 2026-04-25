-- Datacube AU master migration:
-- - fixed-cap limits (non-daily)
-- - billing/promo mutual exclusion
-- - usage totals + atomic increments
-- - session activity metadata
-- - retention cleanup RPC (7d signed-out, 14d inactivity)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.is_conex_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    p_user_id = '05ad2f16-b3ce-48eb-bf24-41b407556ffd'::uuid
    OR EXISTS (
      SELECT 1
      FROM public.au_user_profiles p
      WHERE p.user_id = p_user_id
        AND (
          LOWER(COALESCE(p.tier, '')) = 'admin'
          OR LOWER(COALESCE(to_jsonb(p) ->> 'role', '')) = 'admin'
        )
    ),
    FALSE
  );
$$;

-- Canonical feature flag catalog (no duplicate keys)
INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
VALUES
  ('billing_enabled', TRUE, 'billing', 'Master monetization switch. If true, promo is forced off.', 'global', '{}'::jsonb),
  ('promo_enabled', FALSE, 'billing', 'Promo mode switch. If true, billing is forced off and promo benefits apply.', 'global', '{}'::jsonb),
  ('paid_mode_enabled', FALSE, 'billing', 'Force paid model routing path on backend AI calls.', 'global', '{}'::jsonb),
  ('premium_models_enabled', TRUE, 'billing', 'Enable premium model availability.', 'global', '{}'::jsonb),
  ('premium_models_paid_only', TRUE, 'billing', 'When enabled, only paid users can use premium models.', 'global', '{}'::jsonb),
  ('stripe_live_mode', FALSE, 'billing', 'Toggle Stripe live/test mode behavior.', 'global', '{}'::jsonb),
  ('global_chat_enabled', TRUE, 'chat', 'Enable Global Chat.', 'global', '{}'::jsonb),
  ('limits.alerts.enabled', TRUE, 'limits', 'Enable context-aware limits alerts in UI.', 'global', '{}'::jsonb),
  ('limits.alerts.thresholds', TRUE, 'limits', 'Threshold config for alerts. Config: {"warn":[70,90],"block":[100]}', 'global', '{"warn":[70,90],"block":[100]}'::jsonb),
  ('limits.alerts.cooldown_minutes', TRUE, 'limits', 'Cooldown between repeated alerts. Config: {"minutes":20}', 'global', '{"minutes":20}'::jsonb),
  ('limits.enforcement.enabled', TRUE, 'limits', 'Enable server-side limits enforcement.', 'global', '{}'::jsonb),
  ('limits.ui.upsell.enabled', TRUE, 'limits', 'Enable upsell CTAs in limits alerts.', 'global', '{}'::jsonb),
  ('retention.enforcement.enabled', TRUE, 'retention', 'Enable retention cleanup rules (7-day signed-out and 14-day inactivity).', 'global', '{}'::jsonb),
  ('auth.reauth_modal.enabled', TRUE, 'auth', 'Enable session-expired re-auth modal UX on frontend.', 'global', '{}'::jsonb)
ON CONFLICT (key) DO UPDATE
SET category = EXCLUDED.category,
    description = EXCLUDED.description,
    scope = EXCLUDED.scope,
    config = CASE
      WHEN public.feature_flags.config IS NULL OR public.feature_flags.config = '{}'::jsonb
        THEN EXCLUDED.config
      ELSE public.feature_flags.config
    END;

DELETE FROM public.feature_flags WHERE key IN ('free_pressure_mode_enabled', 'pro_upload_100mb');

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
  v_key TEXT := TRIM(COALESCE(p_key, ''));
  v_row public.feature_flags%ROWTYPE;
BEGIN
  IF v_key = '' THEN
    RAISE EXCEPTION 'flag_key_required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_conex_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: admin tier required' USING ERRCODE = '42501';
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

  -- billing/promo mutual exclusion
  IF v_key = 'billing_enabled' AND v_row.enabled = TRUE THEN
    INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
    VALUES ('promo_enabled', FALSE, 'billing', 'Promo mode switch. If true, billing is forced off and promo benefits apply.', 'global', '{}'::jsonb)
    ON CONFLICT (key) DO UPDATE SET enabled = FALSE, updated_at = now();
  ELSIF v_key = 'promo_enabled' AND v_row.enabled = TRUE THEN
    INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
    VALUES ('billing_enabled', FALSE, 'billing', 'Master monetization switch. If true, promo is forced off.', 'global', '{}'::jsonb)
    ON CONFLICT (key) DO UPDATE SET enabled = FALSE, updated_at = now();
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- Plan limits: migrate from daily caps to fixed caps.
INSERT INTO public.plan_limits (plan, limits, effective_from)
VALUES
  ('free', '{"max_file_mb":10,"max_uploads_total":40,"max_docs_total":40,"max_pages_per_doc":350,"max_chunks_per_doc":1400,"max_chats_total":1000,"max_exams_total":120,"max_tokens_total":2500000,"max_jobs_concurrent":2,"max_storage_mb":1024}'::jsonb, '1970-01-01T00:00:00Z'::timestamptz),
  ('pro', '{"max_file_mb":100,"max_uploads_total":null,"max_docs_total":null,"max_pages_per_doc":1600,"max_chunks_per_doc":12000,"max_chats_total":null,"max_exams_total":null,"max_tokens_total":null,"max_jobs_concurrent":8,"max_storage_mb":20480}'::jsonb, '1970-01-01T00:00:00Z'::timestamptz),
  ('premium', '{"max_file_mb":200,"max_uploads_total":null,"max_docs_total":null,"max_pages_per_doc":4000,"max_chunks_per_doc":40000,"max_chats_total":null,"max_exams_total":null,"max_tokens_total":null,"max_jobs_concurrent":20,"max_storage_mb":102400}'::jsonb, '1970-01-01T00:00:00Z'::timestamptz)
ON CONFLICT (plan, effective_from) DO UPDATE
SET limits = EXCLUDED.limits,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.usage_totals (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  counters JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.usage_totals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_totals_read_own" ON public.usage_totals;
CREATE POLICY "usage_totals_read_own"
ON public.usage_totals
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "usage_totals_service_role" ON public.usage_totals;
CREATE POLICY "usage_totals_service_role"
ON public.usage_totals
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

GRANT SELECT ON public.usage_totals TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_usage_counters(
  p_user_id UUID,
  p_increments JSONB DEFAULT '{}'::jsonb,
  p_day DATE DEFAULT current_date
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today JSONB := '{}'::jsonb;
  v_total JSONB := '{}'::jsonb;
  v_key TEXT;
  v_val JSONB;
  v_inc NUMERIC;
  v_today_cur NUMERIC;
  v_total_cur NUMERIC;
  v_total_next NUMERIC;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF p_increments IS NULL OR jsonb_typeof(p_increments) <> 'object' THEN
    p_increments := '{}'::jsonb;
  END IF;

  INSERT INTO public.usage_counters (user_id, day, counters)
  VALUES (p_user_id, p_day, '{}'::jsonb)
  ON CONFLICT (user_id, day) DO NOTHING;

  INSERT INTO public.usage_totals (user_id, counters)
  VALUES (p_user_id, '{}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT counters INTO v_today
  FROM public.usage_counters
  WHERE user_id = p_user_id AND day = p_day
  FOR UPDATE;

  SELECT counters INTO v_total
  FROM public.usage_totals
  WHERE user_id = p_user_id
  FOR UPDATE;

  v_today := COALESCE(v_today, '{}'::jsonb);
  v_total := COALESCE(v_total, '{}'::jsonb);

  FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_increments)
  LOOP
    IF jsonb_typeof(v_val) <> 'number' THEN CONTINUE; END IF;

    v_inc := (v_val::text)::numeric;
    v_today_cur := COALESCE(NULLIF(v_today ->> v_key, '')::numeric, 0);
    v_total_cur := COALESCE(NULLIF(v_total ->> v_key, '')::numeric, 0);
    v_total_next := v_total_cur + v_inc;

    IF v_key IN ('used_storage_mb', 'uploaded_mb', 'storage_mb') AND v_total_next < 0 THEN
      v_total_next := 0;
    END IF;

    v_today := jsonb_set(v_today, ARRAY[v_key], to_jsonb(v_today_cur + v_inc), TRUE);
    v_total := jsonb_set(v_total, ARRAY[v_key], to_jsonb(v_total_next), TRUE);
  END LOOP;

  UPDATE public.usage_counters
  SET counters = v_today, updated_at = now()
  WHERE user_id = p_user_id AND day = p_day;

  UPDATE public.usage_totals
  SET counters = v_total, updated_at = now()
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('today', v_today, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_usage_snapshot(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_today JSONB := '{}'::jsonb;
  v_total JSONB := '{}'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN p_user_id := v_requester; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF v_requester IS NOT NULL AND p_user_id <> v_requester AND NOT public.is_conex_admin(v_requester) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT counters INTO v_today FROM public.usage_counters WHERE user_id = p_user_id AND day = current_date;
  SELECT counters INTO v_total FROM public.usage_totals WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'day', current_date,
    'today', COALESCE(v_today, '{}'::jsonb),
    'total', COALESCE(v_total, '{}'::jsonb),
    'reset_at', to_char(date_trunc('day', now()) + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_limits(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_plan TEXT := 'free';
  v_limits JSONB := '{}'::jsonb;
  v_overrides JSONB := '{}'::jsonb;
  v_usage JSONB := '{}'::jsonb;
  v_promo_enabled BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL THEN p_user_id := v_requester; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;
  IF v_requester IS NOT NULL AND p_user_id <> v_requester AND NOT public.is_conex_admin(v_requester) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT LOWER(COALESCE(tier, 'free')) INTO v_plan FROM public.au_user_profiles WHERE user_id = p_user_id;
  IF v_plan = 'admin' THEN v_plan := 'premium'; END IF;
  IF v_plan NOT IN ('free', 'pro', 'premium') THEN v_plan := 'free'; END IF;

  SELECT COALESCE(enabled, FALSE) INTO v_promo_enabled
  FROM public.feature_flags WHERE key = 'promo_enabled' LIMIT 1;
  IF v_promo_enabled THEN v_plan := 'premium'; END IF;

  SELECT limits INTO v_limits
  FROM public.plan_limits
  WHERE plan = v_plan AND effective_from <= now()
  ORDER BY effective_from DESC
  LIMIT 1;
  v_limits := COALESCE(v_limits, '{}'::jsonb);

  BEGIN
    EXECUTE 'SELECT COALESCE(limits_override, ''{}''::jsonb) FROM public.au_user_profiles WHERE user_id = $1'
    INTO v_overrides
    USING p_user_id;
  EXCEPTION WHEN undefined_column THEN
    v_overrides := '{}'::jsonb;
  END;
  IF jsonb_typeof(v_overrides) = 'object' THEN
    v_limits := v_limits || v_overrides;
  END IF;

  v_usage := public.get_usage_snapshot(p_user_id);

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'plan', v_plan,
    'limits', v_limits,
    'usage', COALESCE(v_usage, '{}'::jsonb),
    'reset_at', to_char(date_trunc('day', now()) + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'as_of', now()
  );
END;
$$;

ALTER TABLE public.au_user_profiles
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sign_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_session_end_at TIMESTAMPTZ;

UPDATE public.au_user_profiles
SET last_activity_at = COALESCE(last_activity_at, now())
WHERE last_activity_at IS NULL;

CREATE OR REPLACE FUNCTION public.record_user_activity(
  p_user_id UUID DEFAULT auth.uid(),
  p_event TEXT DEFAULT 'activity',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_event TEXT := LOWER(TRIM(COALESCE(p_event, 'activity')));
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF p_user_id IS NULL THEN p_user_id := v_requester; END IF;
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501'; END IF;

  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL OR (v_requester <> p_user_id AND NOT public.is_conex_admin(v_requester)) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.au_user_profiles (user_id, last_activity_at)
  VALUES (p_user_id, v_now)
  ON CONFLICT (user_id) DO UPDATE SET last_activity_at = EXCLUDED.last_activity_at;

  UPDATE public.au_user_profiles
  SET last_activity_at = v_now,
      last_sign_in_at = CASE WHEN v_event IN ('sign_in', 'signin', 'signed_in') THEN v_now ELSE last_sign_in_at END,
      last_sign_out_at = CASE WHEN v_event IN ('sign_out', 'signout', 'signed_out') THEN v_now ELSE last_sign_out_at END,
      last_session_end_at = CASE WHEN v_event IN ('sign_out', 'signout', 'signed_out', 'session_end') THEN v_now ELSE last_session_end_at END
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'event', v_event, 'recorded_at', v_now);
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
  v_inactive_docs BIGINT := 0;
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

    SELECT COUNT(*) INTO v_inactive_docs
    FROM public.au_documents d
    WHERE d.owner_id IN (
      SELECT p.user_id
      FROM public.au_user_profiles p
      WHERE COALESCE(p.last_activity_at, '1970-01-01'::timestamptz) < now() - interval '14 days'
    );

    RETURN jsonb_build_object('ok', true, 'dry_run', true, 'signed_out_docs', v_signed_out_docs, 'inactive_docs', v_inactive_docs);
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
    WHERE d.owner_id IN (
      SELECT p.user_id
      FROM public.au_user_profiles p
      WHERE COALESCE(p.last_activity_at, '1970-01-01'::timestamptz) < now() - interval '14 days'
    )
    RETURNING d.id
  )
  SELECT COUNT(*) INTO v_inactive_docs FROM deleted;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'signed_out_docs_deleted', COALESCE(v_signed_out_docs, 0),
    'inactive_docs_deleted', COALESCE(v_inactive_docs, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_retention_data(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_retention_data(BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_user_activity(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_activity(UUID, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
