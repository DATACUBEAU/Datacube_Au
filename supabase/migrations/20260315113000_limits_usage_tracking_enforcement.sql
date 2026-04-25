BEGIN;

CREATE TABLE IF NOT EXISTS public.au_usage_metric_definitions (
  metric_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('chat', 'token', 'storage', 'generation', 'media', 'api', 'legacy')),
  limit_key TEXT NULL,
  reset_policy TEXT NOT NULL DEFAULT 'daily' CHECK (reset_policy IN ('hourly', 'daily', 'weekly', 'monthly', 'never', 'custom')),
  reset_interval_value INT NULL,
  reset_interval_unit TEXT NULL CHECK (reset_interval_unit IS NULL OR reset_interval_unit IN ('hour', 'day', 'week', 'month')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_integer BOOLEAN NOT NULL DEFAULT TRUE,
  min_value NUMERIC NULL DEFAULT 0,
  max_value NUMERIC NULL,
  description TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.au_usage_metric_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "au_usage_metric_definitions_read_authenticated" ON public.au_usage_metric_definitions;
CREATE POLICY "au_usage_metric_definitions_read_authenticated"
ON public.au_usage_metric_definitions
FOR SELECT
TO authenticated
USING (TRUE);

DROP POLICY IF EXISTS "au_usage_metric_definitions_service_role" ON public.au_usage_metric_definitions;
CREATE POLICY "au_usage_metric_definitions_service_role"
ON public.au_usage_metric_definitions
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

GRANT SELECT ON public.au_usage_metric_definitions TO authenticated;

INSERT INTO public.au_usage_metric_definitions (
  metric_key,
  label,
  unit,
  category,
  limit_key,
  reset_policy,
  reset_interval_value,
  reset_interval_unit,
  is_enabled,
  is_integer,
  min_value,
  max_value,
  description
)
VALUES
  ('max_chats_total', 'Chats', 'messages', 'chat', 'max_chats_total', 'daily', NULL, NULL, TRUE, TRUE, 0, NULL, 'Canonical chat counter used by plan limits.'),
  ('used_chats', 'Chats (legacy)', 'messages', 'legacy', 'max_chats_total', 'daily', NULL, NULL, TRUE, TRUE, 0, NULL, 'Legacy chat counter alias.'),
  ('messages_count', 'Messages (legacy)', 'messages', 'legacy', 'max_chats_total', 'daily', NULL, NULL, TRUE, TRUE, 0, NULL, 'Legacy message counter alias.'),
  ('max_tokens_total', 'Tokens', 'tokens', 'token', 'max_tokens_total', 'daily', NULL, NULL, TRUE, TRUE, 0, NULL, 'Canonical token counter used by plan limits.'),
  ('used_tokens', 'Tokens (legacy)', 'tokens', 'legacy', 'max_tokens_total', 'daily', NULL, NULL, TRUE, TRUE, 0, NULL, 'Legacy token counter alias.'),
  ('tokens_used', 'Tokens Used (legacy)', 'tokens', 'legacy', 'max_tokens_total', 'daily', NULL, NULL, TRUE, TRUE, 0, NULL, 'Legacy token counter alias.'),
  ('api_calls', 'API Calls', 'calls', 'api', NULL, 'daily', NULL, NULL, TRUE, TRUE, 0, NULL, 'Counts backend API requests accepted for processing.'),
  ('max_uploads_total', 'Uploads', 'files', 'storage', 'max_uploads_total', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Canonical upload counter used when upload limits run in usage mode.'),
  ('used_uploads', 'Uploads (legacy)', 'files', 'legacy', 'max_uploads_total', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Legacy upload counter alias.'),
  ('uploads_count', 'Uploads Count (legacy)', 'files', 'legacy', 'max_uploads_total', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Legacy upload counter alias.'),
  ('uploaded_mb', 'Uploaded MB', 'MB', 'storage', NULL, 'monthly', NULL, NULL, TRUE, FALSE, 0, NULL, 'Aggregate uploaded storage in MB.'),
  ('uploaded_bytes', 'Uploaded Bytes', 'bytes', 'storage', NULL, 'monthly', NULL, NULL, TRUE, TRUE, 0, NULL, 'Aggregate uploaded storage in bytes.'),
  ('max_exam_predictions', 'Exam Predictions', 'generations', 'generation', 'max_exam_predictions', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Canonical exam prediction generation counter.'),
  ('prediction_generations', 'Prediction Generations', 'generations', 'generation', 'max_exam_predictions', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Exam prediction generation counter alias.'),
  ('used_exams', 'Exams (legacy)', 'generations', 'legacy', 'max_exam_predictions', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Legacy exam counter alias.'),
  ('exams_count', 'Exams Count (legacy)', 'generations', 'legacy', 'max_exam_predictions', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Legacy exam counter alias.'),
  ('max_practice_exams', 'Practice Exams', 'generations', 'generation', 'max_practice_exams', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Canonical practice exam generation counter.'),
  ('practice_exam_generations', 'Practice Exam Generations', 'generations', 'generation', 'max_practice_exams', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Practice exam generation counter alias.'),
  ('max_knowledge_hub', 'Knowledge Hub', 'items', 'generation', 'max_knowledge_hub', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Canonical knowledge generation/storage counter.'),
  ('knowledge_generations', 'Knowledge Generations', 'items', 'generation', 'max_knowledge_hub', 'never', NULL, NULL, TRUE, TRUE, 0, NULL, 'Knowledge generation counter alias.'),
  ('audio_seconds', 'Audio Seconds', 'seconds', 'media', NULL, 'monthly', NULL, NULL, TRUE, FALSE, 0, NULL, 'Tracks audio processing or generation seconds.'),
  ('image_generations', 'Image Generations', 'images', 'media', NULL, 'monthly', NULL, NULL, TRUE, TRUE, 0, NULL, 'Tracks image-generation requests.')
ON CONFLICT (metric_key) DO UPDATE
SET label = EXCLUDED.label,
    unit = EXCLUDED.unit,
    category = EXCLUDED.category,
    limit_key = EXCLUDED.limit_key,
    reset_policy = EXCLUDED.reset_policy,
    reset_interval_value = EXCLUDED.reset_interval_value,
    reset_interval_unit = EXCLUDED.reset_interval_unit,
    is_enabled = EXCLUDED.is_enabled,
    is_integer = EXCLUDED.is_integer,
    min_value = EXCLUDED.min_value,
    max_value = EXCLUDED.max_value,
    description = EXCLUDED.description,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.au_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'server',
  event_key TEXT NOT NULL,
  request_id TEXT NULL,
  correlation_id TEXT NULL,
  metric_increments JSONB NOT NULL DEFAULT '{}'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_au_usage_events_user_time
  ON public.au_usage_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_au_usage_events_feature_time
  ON public.au_usage_events (feature, occurred_at DESC);

ALTER TABLE public.au_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "au_usage_events_select_own" ON public.au_usage_events;
CREATE POLICY "au_usage_events_select_own"
ON public.au_usage_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.is_conex_admin(auth.uid()));

DROP POLICY IF EXISTS "au_usage_events_service_role" ON public.au_usage_events;
CREATE POLICY "au_usage_events_service_role"
ON public.au_usage_events
FOR ALL
TO service_role
USING (TRUE)
WITH CHECK (TRUE);

GRANT SELECT ON public.au_usage_events TO authenticated;

DROP FUNCTION IF EXISTS public.track_usage_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.track_usage_event(
  p_user_id UUID,
  p_event_key TEXT,
  p_feature TEXT,
  p_source TEXT DEFAULT 'server',
  p_metrics JSONB DEFAULT '{}'::jsonb,
  p_request_id TEXT DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL,
  p_context JSONB DEFAULT '{}'::jsonb,
  p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_event_key TEXT := NULLIF(TRIM(COALESCE(p_event_key, '')), '');
  v_feature TEXT := NULLIF(TRIM(COALESCE(p_feature, '')), '');
  v_metric_key TEXT;
  v_metric_value JSONB;
  v_numeric NUMERIC;
  v_day DATE := (COALESCE(p_occurred_at, now()) AT TIME ZONE 'UTC')::date;
  v_event_id UUID;
  v_definition public.au_usage_metric_definitions%ROWTYPE;
  v_snapshot JSONB := '{}'::jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_event_key IS NULL THEN
    RAISE EXCEPTION 'p_event_key is required' USING ERRCODE = '22023';
  END IF;
  IF v_feature IS NULL THEN
    RAISE EXCEPTION 'p_feature is required' USING ERRCODE = '22023';
  END IF;
  IF p_metrics IS NULL OR jsonb_typeof(p_metrics) <> 'object' OR p_metrics = '{}'::jsonb THEN
    RAISE EXCEPTION 'p_metrics must be a non-empty object' USING ERRCODE = '22023';
  END IF;

  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
    IF v_requester <> p_user_id AND NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_metric_key, v_metric_value IN SELECT key, value FROM jsonb_each(p_metrics)
  LOOP
    SELECT *
    INTO v_definition
    FROM public.au_usage_metric_definitions
    WHERE metric_key = v_metric_key
      AND is_enabled = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'unknown_usage_metric:%', v_metric_key USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_metric_value) <> 'number' THEN
      RAISE EXCEPTION 'usage_metric_must_be_numeric:%', v_metric_key USING ERRCODE = '22023';
    END IF;

    v_numeric := (v_metric_value::text)::numeric;

    IF v_definition.is_integer AND v_numeric <> trunc(v_numeric) THEN
      RAISE EXCEPTION 'usage_metric_must_be_integer:%', v_metric_key USING ERRCODE = '22023';
    END IF;

    IF v_definition.min_value IS NOT NULL AND v_numeric < v_definition.min_value THEN
      RAISE EXCEPTION 'usage_metric_below_min:%', v_metric_key USING ERRCODE = '22023';
    END IF;

    IF v_definition.max_value IS NOT NULL AND v_numeric > v_definition.max_value THEN
      RAISE EXCEPTION 'usage_metric_above_max:%', v_metric_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO public.au_usage_events (
    user_id,
    feature,
    source,
    event_key,
    request_id,
    correlation_id,
    metric_increments,
    context,
    occurred_at
  )
  VALUES (
    p_user_id,
    v_feature,
    COALESCE(NULLIF(TRIM(COALESCE(p_source, '')), ''), 'server'),
    v_event_key,
    NULLIF(TRIM(COALESCE(p_request_id, '')), ''),
    NULLIF(TRIM(COALESCE(p_correlation_id, '')), ''),
    p_metrics,
    COALESCE(p_context, '{}'::jsonb),
    COALESCE(p_occurred_at, now())
  )
  ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.au_usage_events
    WHERE user_id = p_user_id
      AND event_key = v_event_key
    LIMIT 1;

    v_snapshot := public.get_usage_snapshot(p_user_id);
    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'event_id', v_event_id,
      'event_key', v_event_key,
      'snapshot', COALESCE(v_snapshot, '{}'::jsonb)
    );
  END IF;

  PERFORM public.increment_usage_counters(
    p_user_id,
    p_metrics,
    v_day
  );

  v_snapshot := public.get_usage_snapshot(p_user_id);

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'event_id', v_event_id,
    'event_key', v_event_key,
    'snapshot', COALESCE(v_snapshot, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.track_usage_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_usage_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.track_usage_event(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TIMESTAMPTZ) TO service_role;

DROP FUNCTION IF EXISTS public.get_usage_metric_window_totals(UUID, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.get_usage_metric_window_totals(
  p_user_id UUID DEFAULT auth.uid(),
  p_metric_keys TEXT[] DEFAULT NULL,
  p_window_start TIMESTAMPTZ DEFAULT NULL,
  p_window_end TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_totals JSONB := '{}'::jsonb;
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

  SELECT COALESCE(jsonb_object_agg(metric_key, total_value), '{}'::jsonb)
  INTO v_totals
  FROM (
    SELECT
      entry.key AS metric_key,
      SUM((entry.value::text)::numeric) AS total_value
    FROM public.au_usage_events event_row
    CROSS JOIN LATERAL jsonb_each(event_row.metric_increments) entry
    WHERE event_row.user_id = p_user_id
      AND (p_window_start IS NULL OR event_row.occurred_at >= p_window_start)
      AND (p_window_end IS NULL OR event_row.occurred_at < p_window_end)
      AND (p_metric_keys IS NULL OR entry.key = ANY (p_metric_keys))
    GROUP BY entry.key
  ) summed;

  RETURN COALESCE(v_totals, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_usage_metric_window_totals(UUID, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_usage_metric_window_totals(UUID, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_usage_metric_window_totals(UUID, TEXT[], TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMIT;
