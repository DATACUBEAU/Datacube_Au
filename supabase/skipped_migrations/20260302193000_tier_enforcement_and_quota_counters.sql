-- Free vs Pro tier enforcement foundation.
-- Note: public.usage_counters already exists in this project (legacy JSON counters),
-- so atomic tier counters are introduced in public.quota_usage_counters.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.feature_flags (key, enabled, category, description, scope, config)
VALUES (
  'upload_100mb',
  FALSE,
  'upload',
  'If enabled, max upload size is 100MB for all users; otherwise 50MB for all users.',
  'global',
  '{}'::jsonb
)
ON CONFLICT (key) DO UPDATE
SET category = EXCLUDED.category,
    description = EXCLUDED.description,
    scope = EXCLUDED.scope;

ALTER TABLE public.au_documents
  ADD COLUMN IF NOT EXISTS upload_quota_counted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.quota_policies (
  key text PRIMARY KEY,
  period text NOT NULL CHECK (period IN ('minute', 'hour', 'day', 'week', 'month', 'lifetime')),
  free_limit integer,
  pro_limit integer,
  promo_pro_limit integer,
  is_active boolean NOT NULL DEFAULT true,
  description text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quota_usage_counters (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL REFERENCES public.quota_policies(key) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  count bigint NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key, period_start)
);

CREATE INDEX IF NOT EXISTS idx_quota_usage_counters_lookup
  ON public.quota_usage_counters (key, period_end DESC, user_id);

CREATE TABLE IF NOT EXISTS public.limit_events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  route text NOT NULL DEFAULT '',
  tier text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_limit_events_user_time
  ON public.limit_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_limit_events_key_time
  ON public.limit_events (key, created_at DESC);

ALTER TABLE public.quota_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quota_usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.limit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quota_policies_read_all" ON public.quota_policies;
CREATE POLICY "quota_policies_read_all"
ON public.quota_policies
FOR SELECT
USING (TRUE);

DROP POLICY IF EXISTS "quota_policies_service_role_all" ON public.quota_policies;
CREATE POLICY "quota_policies_service_role_all"
ON public.quota_policies
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "quota_usage_read_own_or_admin" ON public.quota_usage_counters;
CREATE POLICY "quota_usage_read_own_or_admin"
ON public.quota_usage_counters
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "quota_usage_service_role_all" ON public.quota_usage_counters;
CREATE POLICY "quota_usage_service_role_all"
ON public.quota_usage_counters
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

DROP POLICY IF EXISTS "limit_events_read_own_or_admin" ON public.limit_events;
CREATE POLICY "limit_events_read_own_or_admin"
ON public.limit_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "limit_events_service_role_all" ON public.limit_events;
CREATE POLICY "limit_events_service_role_all"
ON public.limit_events
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

GRANT SELECT ON public.quota_policies TO anon;
GRANT SELECT ON public.quota_policies TO authenticated;
GRANT SELECT ON public.quota_usage_counters TO authenticated;
GRANT SELECT ON public.limit_events TO authenticated;

INSERT INTO public.quota_policies (key, period, free_limit, pro_limit, promo_pro_limit, is_active, description)
VALUES
  ('messages_per_day', 'day', 35, 400, 400, TRUE, 'Total AU chat + global chat messages per day.'),
  ('chat_requests_per_minute', 'minute', 8, 30, 30, TRUE, 'Burst control for chat requests.'),
  ('knowledge_generations_per_day', 'day', 4, 60, 60, TRUE, 'Knowledge generation runs per day.'),
  ('prompt_starters_per_day', 'day', 10, 120, 120, TRUE, 'Prompt starter generations per day.'),
  ('practice_exams_per_day', 'day', 0, 25, 25, TRUE, 'Practice exam generations per day.'),
  ('predictions_per_day', 'day', 0, 25, 25, TRUE, 'Exam prediction runs per day.'),
  ('max_documents_uploaded_total', 'lifetime', 4, 10, 10, TRUE, 'Lifetime uploaded documents count.')
ON CONFLICT (key) DO UPDATE
SET period = EXCLUDED.period,
    free_limit = EXCLUDED.free_limit,
    pro_limit = EXCLUDED.pro_limit,
    promo_pro_limit = EXCLUDED.promo_pro_limit,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description,
    updated_at = now();

-- Align legacy plan_limits with hard constraints consumed by existing usage-status UI.
UPDATE public.plan_limits
SET limits = jsonb_set(
              jsonb_set(COALESCE(limits, '{}'::jsonb), '{max_uploads_total}', to_jsonb(4), TRUE),
              '{max_file_mb}', to_jsonb(50), TRUE
            ),
    updated_at = now()
WHERE plan = 'free';

UPDATE public.plan_limits
SET limits = jsonb_set(
              jsonb_set(COALESCE(limits, '{}'::jsonb), '{max_uploads_total}', to_jsonb(10), TRUE),
              '{max_file_mb}', to_jsonb(50), TRUE
            ),
    updated_at = now()
WHERE plan IN ('pro', 'premium');

CREATE OR REPLACE FUNCTION public._quota_period_bounds(
  p_period text,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(period_start timestamptz, period_end timestamptz)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_period text := lower(trim(coalesce(p_period, 'day')));
  v_now_lagos timestamp;
  v_start_local timestamp;
  v_end_local timestamp;
BEGIN
  IF v_period = 'lifetime' THEN
    RETURN QUERY SELECT
      '1970-01-01T00:00:00Z'::timestamptz,
      '9999-12-31T23:59:59Z'::timestamptz;
    RETURN;
  END IF;

  v_now_lagos := p_now AT TIME ZONE 'Africa/Lagos';

  CASE v_period
    WHEN 'minute' THEN
      v_start_local := date_trunc('minute', v_now_lagos);
      v_end_local := v_start_local + interval '1 minute';
    WHEN 'hour' THEN
      v_start_local := date_trunc('hour', v_now_lagos);
      v_end_local := v_start_local + interval '1 hour';
    WHEN 'week' THEN
      v_start_local := date_trunc('week', v_now_lagos);
      v_end_local := v_start_local + interval '1 week';
    WHEN 'month' THEN
      v_start_local := date_trunc('month', v_now_lagos);
      v_end_local := v_start_local + interval '1 month';
    ELSE
      v_start_local := date_trunc('day', v_now_lagos);
      v_end_local := v_start_local + interval '1 day';
  END CASE;

  RETURN QUERY
  SELECT
    v_start_local AT TIME ZONE 'Africa/Lagos',
    v_end_local AT TIME ZONE 'Africa/Lagos';
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_quota_counter(
  p_user_id uuid,
  p_key text,
  p_tier text,
  p_increment integer DEFAULT 1,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := trim(coalesce(p_key, ''));
  v_tier text := lower(trim(coalesce(p_tier, 'free')));
  v_increment integer := greatest(0, coalesce(p_increment, 0));
  v_policy record;
  v_limit integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_existing_count bigint := 0;
  v_new_count bigint := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF v_key = '' THEN
    RAISE EXCEPTION 'p_key is required';
  END IF;

  SELECT *
  INTO v_policy
  FROM public.quota_policies
  WHERE key = v_key
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', TRUE,
      'key', v_key,
      'count', 0,
      'limit', NULL,
      'period_end', NULL
    );
  END IF;

  IF v_tier = 'promo_pro' AND v_policy.promo_pro_limit IS NOT NULL THEN
    v_limit := v_policy.promo_pro_limit;
  ELSIF v_tier = 'pro' OR v_tier = 'promo_pro' THEN
    v_limit := v_policy.pro_limit;
  ELSE
    v_limit := v_policy.free_limit;
  END IF;

  SELECT period_start, period_end
  INTO v_period_start, v_period_end
  FROM public._quota_period_bounds(v_policy.period, p_now);

  INSERT INTO public.quota_usage_counters (user_id, key, period_start, period_end, count, updated_at)
  VALUES (p_user_id, v_key, v_period_start, v_period_end, 0, now())
  ON CONFLICT (user_id, key, period_start) DO NOTHING;

  SELECT count
  INTO v_existing_count
  FROM public.quota_usage_counters
  WHERE user_id = p_user_id
    AND key = v_key
    AND period_start = v_period_start
  FOR UPDATE;

  v_existing_count := coalesce(v_existing_count, 0);

  IF coalesce(v_limit, 0) > 0 AND v_existing_count + v_increment > v_limit THEN
    RETURN jsonb_build_object(
      'allowed', FALSE,
      'key', v_key,
      'count', v_existing_count,
      'limit', v_limit,
      'period_end', v_period_end
    );
  END IF;

  v_new_count := v_existing_count + v_increment;

  UPDATE public.quota_usage_counters
  SET count = v_new_count,
      period_end = v_period_end,
      updated_at = now()
  WHERE user_id = p_user_id
    AND key = v_key
    AND period_start = v_period_start;

  RETURN jsonb_build_object(
    'allowed', TRUE,
    'key', v_key,
    'count', v_new_count,
    'limit', v_limit,
    'period_end', v_period_end
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_document_upload_quota(
  p_user_id uuid,
  p_document_id uuid,
  p_tier text DEFAULT 'free',
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc record;
  v_payload jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;
  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'p_document_id is required';
  END IF;

  SELECT id, owner_id, user_id, upload_quota_counted_at
  INTO v_doc
  FROM public.au_documents
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', FALSE,
      'key', 'max_documents_uploaded_total',
      'count', 0,
      'limit', 0,
      'period_end', NULL,
      'reason', 'document_not_found'
    );
  END IF;

  IF coalesce(v_doc.owner_id, v_doc.user_id) <> p_user_id THEN
    RETURN jsonb_build_object(
      'allowed', FALSE,
      'key', 'max_documents_uploaded_total',
      'count', 0,
      'limit', 0,
      'period_end', NULL,
      'reason', 'forbidden'
    );
  END IF;

  IF v_doc.upload_quota_counted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'allowed', TRUE,
      'key', 'max_documents_uploaded_total',
      'consumed', FALSE
    );
  END IF;

  v_payload := public.consume_quota_counter(
    p_user_id,
    'max_documents_uploaded_total',
    p_tier,
    1,
    p_now
  );

  IF coalesce((v_payload ->> 'allowed')::boolean, FALSE) = FALSE THEN
    RETURN v_payload;
  END IF;

  UPDATE public.au_documents
  SET upload_quota_counted_at = now()
  WHERE id = p_document_id;

  RETURN v_payload || jsonb_build_object(
    'allowed', TRUE,
    'key', 'max_documents_uploaded_total',
    'consumed', TRUE,
    'document_id', p_document_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_quota_counter(uuid, text, text, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_document_upload_quota(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_quota_counter(uuid, text, text, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_document_upload_quota(uuid, uuid, text, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
