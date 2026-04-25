-- Standardized feature flags, limits, and usage counters for Datacube AU
-- Source of truth tables: public.feature_flags, public.plan_limits, public.usage_counters

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

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

REVOKE ALL ON FUNCTION public.is_conex_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_conex_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conex_admin(UUID) TO service_role;

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'org', 'user')),
  org_id UUID NULL,
  user_id UUID NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_category ON public.feature_flags(category);
CREATE INDEX IF NOT EXISTS idx_feature_flags_scope ON public.feature_flags(scope);
CREATE INDEX IF NOT EXISTS idx_feature_flags_user_id ON public.feature_flags(user_id);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_flags_read_by_scope" ON public.feature_flags;
CREATE POLICY "feature_flags_read_by_scope"
ON public.feature_flags
FOR SELECT
USING (
  public.is_conex_admin(auth.uid())
  OR scope = 'global'
  OR (scope = 'user' AND user_id = auth.uid())
  OR (scope = 'org' AND public.is_conex_admin(auth.uid()))
);

DROP POLICY IF EXISTS "feature_flags_admin_write" ON public.feature_flags;
CREATE POLICY "feature_flags_admin_write"
ON public.feature_flags
FOR ALL
TO authenticated
USING (public.is_conex_admin(auth.uid()))
WITH CHECK (public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "feature_flags_service_role" ON public.feature_flags;
CREATE POLICY "feature_flags_service_role"
ON public.feature_flags
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

GRANT SELECT ON public.feature_flags TO anon;
GRANT SELECT ON public.feature_flags TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.feature_flags TO authenticated;

DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
BEFORE UPDATE ON public.feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

ALTER TABLE public.feature_flags REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'feature_flags'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.feature_flags';
    END IF;
  END IF;
END;
$$;

-- Backfill from legacy flag table when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'au_feature_flags'
  ) THEN
    INSERT INTO public.feature_flags (key, enabled, category, description, scope, config, updated_at)
    SELECT
      f.key,
      COALESCE(f.is_enabled, FALSE),
      'billing',
      COALESCE(f.description, ''),
      'global',
      '{}'::jsonb,
      COALESCE(f.updated_at, now())
    FROM public.au_feature_flags f
    ON CONFLICT (key) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        description = EXCLUDED.description,
        updated_at = EXCLUDED.updated_at;
  END IF;
END;
$$;

INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
VALUES
  ('global_chat_enabled', TRUE, 'chat', 'Enable global chat across the app.', 'global', '{}'::jsonb),
  ('premium_models_enabled', TRUE, 'billing', 'Master switch for premium model availability.', 'global', '{}'::jsonb),
  ('premium_models_paid_only', TRUE, 'billing', 'Restrict premium models to paid users when enabled.', 'global', '{}'::jsonb),
  ('billing_enabled', TRUE, 'billing', 'Master billing/monetization toggle.', 'global', '{}'::jsonb),
  ('paid_mode_enabled', FALSE, 'billing', 'Force paid key path for model calls.', 'global', '{}'::jsonb),
  ('free_pressure_mode_enabled', FALSE, 'billing', 'Enable strict free-tier pressure mode.', 'global', '{}'::jsonb),
  ('pro_upload_100mb', FALSE, 'upload', 'Allow pro users to upload files up to 100MB.', 'global', '{}'::jsonb),
  ('limits.alerts.enabled', TRUE, 'limits', 'Enable contextual limitations alerts agent.', 'global', '{}'::jsonb),
  ('limits.alerts.thresholds', TRUE, 'limits', 'Threshold config for limits alerts.', 'global', '{"warn":[70,90],"block":[100]}'::jsonb),
  ('limits.alerts.cooldown_minutes', TRUE, 'limits', 'Cooldown minutes between repeated alerts.', 'global', '{"minutes":20}'::jsonb),
  ('limits.enforcement.enabled', TRUE, 'limits', 'Enable server-side limits enforcement.', 'global', '{}'::jsonb),
  ('limits.ui.upsell.enabled', TRUE, 'limits', 'Enable upsell CTAs in limits alerts.', 'global', '{}'::jsonb)
ON CONFLICT (key) DO UPDATE
SET category = EXCLUDED.category,
    description = EXCLUDED.description,
    scope = EXCLUDED.scope,
    config = CASE
      WHEN public.feature_flags.config IS NULL OR public.feature_flags.config = '{}'::jsonb THEN EXCLUDED.config
      ELSE public.feature_flags.config
    END;

-- Compatibility sync: feature_flags -> au_feature_flags
CREATE OR REPLACE FUNCTION public.sync_feature_flags_to_legacy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'au_feature_flags'
  ) THEN
    IF TG_OP = 'DELETE' THEN
      DELETE FROM public.au_feature_flags WHERE key = OLD.key;
      RETURN OLD;
    END IF;

    INSERT INTO public.au_feature_flags (key, is_enabled, description, updated_at)
    VALUES (NEW.key, NEW.enabled, NEW.description, NEW.updated_at)
    ON CONFLICT (key) DO UPDATE
    SET is_enabled = EXCLUDED.is_enabled,
        description = EXCLUDED.description,
        updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_flags_to_legacy ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_to_legacy
AFTER INSERT OR UPDATE OR DELETE ON public.feature_flags
FOR EACH ROW
EXECUTE FUNCTION public.sync_feature_flags_to_legacy();

-- Compatibility sync: au_feature_flags -> feature_flags
CREATE OR REPLACE FUNCTION public.sync_legacy_feature_flags_to_feature_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.feature_flags WHERE key = OLD.key;
    RETURN OLD;
  END IF;

  INSERT INTO public.feature_flags (key, enabled, category, description, scope, config, updated_at)
  VALUES (NEW.key, NEW.is_enabled, 'billing', COALESCE(NEW.description, ''), 'global', '{}'::jsonb, COALESCE(NEW.updated_at, now()))
  ON CONFLICT (key) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'au_feature_flags'
  ) THEN
    DROP TRIGGER IF EXISTS trg_legacy_feature_flags_to_feature_flags ON public.au_feature_flags;
    CREATE TRIGGER trg_legacy_feature_flags_to_feature_flags
    AFTER INSERT OR UPDATE OR DELETE ON public.au_feature_flags
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_legacy_feature_flags_to_feature_flags();
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
  v_row public.feature_flags%ROWTYPE;
BEGIN
  IF NOT public.is_conex_admin(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
  VALUES (
    TRIM(p_key),
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

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO service_role;

CREATE TABLE IF NOT EXISTS public.plan_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan TEXT NOT NULL,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plan, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_plan_limits_plan_effective_from ON public.plan_limits(plan, effective_from DESC);

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_limits_read" ON public.plan_limits;
CREATE POLICY "plan_limits_read"
ON public.plan_limits
FOR SELECT
USING (TRUE);

DROP POLICY IF EXISTS "plan_limits_admin_write" ON public.plan_limits;
CREATE POLICY "plan_limits_admin_write"
ON public.plan_limits
FOR ALL
TO authenticated
USING (public.is_conex_admin(auth.uid()))
WITH CHECK (public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "plan_limits_service_role" ON public.plan_limits;
CREATE POLICY "plan_limits_service_role"
ON public.plan_limits
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

GRANT SELECT ON public.plan_limits TO anon;
GRANT SELECT ON public.plan_limits TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.plan_limits TO authenticated;

DROP TRIGGER IF EXISTS trg_plan_limits_updated_at ON public.plan_limits;
CREATE TRIGGER trg_plan_limits_updated_at
BEFORE UPDATE ON public.plan_limits
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

INSERT INTO public.plan_limits (plan, limits, effective_from)
VALUES
  (
    'free',
    '{
      "max_file_mb": 50,
      "max_uploads_per_day": 3,
      "max_docs_total": 20,
      "max_pages_per_doc": 300,
      "max_chunks_per_doc": 1200,
      "max_messages_per_day": 60,
      "max_tokens_per_day": 180000,
      "max_jobs_concurrent": 2,
      "max_storage_mb": 1024
    }'::jsonb,
    '1970-01-01T00:00:00Z'::timestamptz
  ),
  (
    'pro',
    '{
      "max_file_mb": 100,
      "max_uploads_per_day": 20,
      "max_docs_total": 200,
      "max_pages_per_doc": 1200,
      "max_chunks_per_doc": 8000,
      "max_messages_per_day": 600,
      "max_tokens_per_day": 2000000,
      "max_jobs_concurrent": 8,
      "max_storage_mb": 10240
    }'::jsonb,
    '1970-01-01T00:00:00Z'::timestamptz
  ),
  (
    'premium',
    '{
      "max_file_mb": 200,
      "max_uploads_per_day": 100,
      "max_docs_total": 1000,
      "max_pages_per_doc": 3000,
      "max_chunks_per_doc": 20000,
      "max_messages_per_day": 2500,
      "max_tokens_per_day": 10000000,
      "max_jobs_concurrent": 20,
      "max_storage_mb": 51200
    }'::jsonb,
    '1970-01-01T00:00:00Z'::timestamptz
  )
ON CONFLICT (plan, effective_from) DO UPDATE
SET limits = EXCLUDED.limits,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.usage_counters (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT current_date,
  counters JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_day ON public.usage_counters(day DESC);

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usage_counters_read_own" ON public.usage_counters;
CREATE POLICY "usage_counters_read_own"
ON public.usage_counters
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "usage_counters_service_role" ON public.usage_counters;
CREATE POLICY "usage_counters_service_role"
ON public.usage_counters
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

GRANT SELECT ON public.usage_counters TO authenticated;

DROP TRIGGER IF EXISTS trg_usage_counters_updated_at ON public.usage_counters;
CREATE TRIGGER trg_usage_counters_updated_at
BEFORE UPDATE ON public.usage_counters
FOR EACH ROW
EXECUTE FUNCTION public.set_row_updated_at();

ALTER TABLE public.usage_counters REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'usage_counters'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_counters';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'plan_limits'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.plan_limits';
    END IF;
  END IF;
END;
$$;

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
  v_existing JSONB := '{}'::jsonb;
  v_next JSONB := '{}'::jsonb;
  v_key TEXT;
  v_val JSONB;
  v_inc NUMERIC;
  v_cur NUMERIC;
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

  SELECT counters
  INTO v_existing
  FROM public.usage_counters
  WHERE user_id = p_user_id
    AND day = p_day
  FOR UPDATE;

  v_next := COALESCE(v_existing, '{}'::jsonb);

  FOR v_key, v_val IN
    SELECT key, value
    FROM jsonb_each(p_increments)
  LOOP
    IF jsonb_typeof(v_val) <> 'number' THEN
      CONTINUE;
    END IF;

    v_inc := (v_val::text)::numeric;
    v_cur := COALESCE(NULLIF(v_next ->> v_key, '')::numeric, 0);

    v_next := jsonb_set(
      v_next,
      ARRAY[v_key],
      to_jsonb(v_cur + v_inc),
      TRUE
    );
  END LOOP;

  UPDATE public.usage_counters
  SET counters = v_next,
      updated_at = now()
  WHERE user_id = p_user_id
    AND day = p_day;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_usage_counters(UUID, JSONB, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_usage_counters(UUID, JSONB, DATE) TO service_role;

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
  v_row RECORD;
  v_counter_key TEXT;
  v_counter_value JSONB;
  v_total_current NUMERIC;
  v_increment NUMERIC;
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

  SELECT counters
  INTO v_today
  FROM public.usage_counters
  WHERE user_id = p_user_id
    AND day = current_date;

  FOR v_row IN
    SELECT counters
    FROM public.usage_counters
    WHERE user_id = p_user_id
  LOOP
    FOR v_counter_key, v_counter_value IN
      SELECT key, value
      FROM jsonb_each(COALESCE(v_row.counters, '{}'::jsonb))
    LOOP
      IF jsonb_typeof(v_counter_value) <> 'number' THEN
        CONTINUE;
      END IF;

      v_increment := (v_counter_value::text)::numeric;
      v_total_current := COALESCE(NULLIF(v_total ->> v_counter_key, '')::numeric, 0);
      v_total := jsonb_set(v_total, ARRAY[v_counter_key], to_jsonb(v_total_current + v_increment), TRUE);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'day', current_date,
    'today', COALESCE(v_today, '{}'::jsonb),
    'total', COALESCE(v_total, '{}'::jsonb),
    'reset_at', to_char(date_trunc('day', now()) + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SSOF')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_usage_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usage_snapshot(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_usage_snapshot(UUID) TO service_role;

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

  SELECT LOWER(COALESCE(p.tier, 'free'))
  INTO v_plan
  FROM public.au_user_profiles p
  WHERE p.user_id = p_user_id;

  IF v_plan NOT IN ('free', 'pro', 'premium') THEN
    v_plan := 'free';
  END IF;

  SELECT l.limits
  INTO v_limits
  FROM public.plan_limits l
  WHERE l.plan = v_plan
    AND l.effective_from <= now()
  ORDER BY l.effective_from DESC
  LIMIT 1;

  v_limits := COALESCE(v_limits, '{}'::jsonb);

  BEGIN
    EXECUTE 'SELECT COALESCE(limits_override, ''{}''::jsonb) FROM public.au_user_profiles WHERE user_id = $1'
    INTO v_overrides
    USING p_user_id;
  EXCEPTION
    WHEN undefined_column THEN
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

REVOKE ALL ON FUNCTION public.get_effective_limits(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_limits(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_limits(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
