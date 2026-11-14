-- Preserve mutable legacy/hybrid usage baselines before applying admin corrections.
--
-- Canonical usage temporarily reconciles durable tracked counters with legacy source
-- rows by taking the larger baseline. A signed admin adjustment alone is unsafe when
-- that larger baseline comes from mutable legacy rows: deleting those rows later can
-- make the fixed correction suppress new legitimate usage. Before any correction,
-- checkpoint only the legacy-over-tracked gap into the existing auditable usage-event
-- system while holding the same per-user mutation-version lock.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_usage_metric_aliases(p_metric_key TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE TRIM(COALESCE(p_metric_key, ''))
    WHEN 'max_chats_total' THEN ARRAY['max_chats_total', 'used_chats', 'messages_count']::TEXT[]
    WHEN 'max_tokens_total' THEN ARRAY['max_tokens_total', 'used_tokens', 'tokens_used']::TEXT[]
    WHEN 'max_uploads_total' THEN ARRAY['max_uploads_total', 'used_uploads', 'uploads_count']::TEXT[]
    WHEN 'max_exam_predictions' THEN ARRAY['max_exam_predictions', 'prediction_generations', 'used_exams', 'exams_count']::TEXT[]
    WHEN 'max_practice_exams' THEN ARRAY['max_practice_exams', 'practice_exam_generations']::TEXT[]
    WHEN 'max_knowledge_hub' THEN ARRAY['max_knowledge_hub', 'knowledge_generations']::TEXT[]
    ELSE ARRAY[TRIM(COALESCE(p_metric_key, ''))]::TEXT[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_usage_json_metric_value(
  p_counters JSONB,
  p_aliases TEXT[]
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_alias TEXT;
  v_raw TEXT;
BEGIN
  FOREACH v_alias IN ARRAY COALESCE(p_aliases, ARRAY[]::TEXT[])
  LOOP
    v_raw := COALESCE(p_counters, '{}'::jsonb) ->> v_alias;
    IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN v_raw::numeric;
    END IF;
  END LOOP;
  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_usage_tracked_value(
  p_user_id UUID,
  p_metric_key TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_aliases TEXT[] := public.admin_usage_metric_aliases(p_metric_key);
  v_counters JSONB := '{}'::jsonb;
  v_window_totals JSONB := '{}'::jsonb;
BEGIN
  IF p_user_id IS NULL OR p_window_start IS NULL THEN
    RETURN 0;
  END IF;

  -- Lifetime usage is authoritative in usage_totals, including atomic reservation
  -- mutations which do not necessarily have a matching au_usage_events row.
  IF p_window_end IS NULL AND p_window_start <= '1970-01-02T00:00:00Z'::timestamptz THEN
    SELECT counters INTO v_counters
    FROM public.usage_totals
    WHERE user_id = p_user_id;
    RETURN GREATEST(0, public.admin_usage_json_metric_value(v_counters, v_aliases));
  END IF;

  -- Daily usage is authoritative in usage_counters for the same reason.
  IF p_window_end = p_window_start + interval '1 day'
     AND p_window_start = date_trunc('day', p_window_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN
    SELECT counters INTO v_counters
    FROM public.usage_counters
    WHERE user_id = p_user_id
      AND day = (p_window_start AT TIME ZONE 'UTC')::date;
    RETURN GREATEST(0, public.admin_usage_json_metric_value(v_counters, v_aliases));
  END IF;

  -- Custom windows are reconstructed from the append-only event ledger.
  v_window_totals := public.get_usage_metric_window_totals(
    p_user_id,
    v_aliases,
    p_window_start,
    p_window_end
  );
  RETURN GREATEST(0, public.admin_usage_json_metric_value(v_window_totals, v_aliases));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_checkpoint_legacy_usage_gap(
  p_target_user_id UUID,
  p_metric_key TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ,
  p_expected_adjustment_total NUMERIC,
  p_request_id TEXT,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_effective NUMERIC := 0;
  v_base_used NUMERIC := 0;
  v_tracked_used NUMERIC := 0;
  v_checkpoint_delta NUMERIC := 0;
  v_event_key TEXT;
BEGIN
  IF p_target_user_id IS NULL OR p_window_start IS NULL THEN
    RETURN 0;
  END IF;

  IF COALESCE(p_context, '{}'::jsonb) ? 'previous_usage' THEN
    BEGIN
      v_previous_effective := GREATEST(0, (p_context ->> 'previous_usage')::numeric);
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_previous_usage' USING ERRCODE = '22023';
    END;
  END IF;

  -- The admin API supplies effective usage before mutation. While effective usage is
  -- positive, removing the already-observed adjustment reconstructs the canonical
  -- pre-adjustment base exactly. This PR introduces the adjustment system, so there are
  -- no deployed historical clamped corrections that require migration/backfill.
  IF v_previous_effective <= 0 THEN
    RETURN 0;
  END IF;

  v_base_used := GREATEST(0, v_previous_effective - COALESCE(p_expected_adjustment_total, 0));
  v_tracked_used := public.admin_usage_tracked_value(
    p_target_user_id,
    p_metric_key,
    p_window_start,
    p_window_end
  );
  v_checkpoint_delta := GREATEST(0, v_base_used - v_tracked_used);

  IF v_checkpoint_delta <= 0 THEN
    RETURN 0;
  END IF;

  IF NULLIF(TRIM(COALESCE(p_request_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'usage_checkpoint_request_id_required' USING ERRCODE = '22023';
  END IF;

  v_event_key := 'admin_usage_checkpoint:' || TRIM(p_request_id) || ':' || TRIM(p_metric_key);

  PERFORM public.track_usage_event(
    p_target_user_id,
    v_event_key,
    'admin_usage_checkpoint',
    'conex_admin_reconciliation',
    jsonb_build_object(TRIM(p_metric_key), v_checkpoint_delta),
    TRIM(p_request_id),
    NULL,
    jsonb_build_object(
      'reason', 'legacy_baseline_reconciliation',
      'metric_key', TRIM(p_metric_key),
      'tracked_before', v_tracked_used,
      'base_before', v_base_used
    ),
    now()
  );

  RETURN v_checkpoint_delta;
END;
$$;

-- Keep the public RPC signature stable for the application while strengthening its
-- internals. The checkpoint and adjustment execute in the same transaction and under
-- the same per-user usage-version row lock.
CREATE OR REPLACE FUNCTION public.admin_adjust_usage_versioned(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_metric_key TEXT,
  p_delta NUMERIC,
  p_action TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_expected_adjustment_total NUMERIC DEFAULT 0,
  p_expected_usage_version BIGINT DEFAULT 0,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_version BIGINT := 0;
  v_checkpoint_delta NUMERIC := 0;
  v_result JSONB;
BEGIN
  IF p_target_user_id IS NULL OR p_expected_usage_version IS NULL OR p_expected_usage_version < 0 THEN
    RAISE EXCEPTION 'invalid_usage_version' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
  VALUES (p_target_user_id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT version INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_version, 0) <> p_expected_usage_version THEN
    RAISE EXCEPTION 'usage_mutation_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Metered usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  v_checkpoint_delta := public.admin_checkpoint_legacy_usage_gap(
    p_target_user_id,
    p_metric_key,
    p_window_start,
    p_window_end,
    p_expected_adjustment_total,
    p_request_id,
    p_context
  );

  v_result := public.admin_adjust_usage_checked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    p_metric_key,
    p_delta,
    p_action,
    p_window_start,
    p_window_end,
    p_reason,
    p_request_id,
    p_expected_adjustment_total,
    p_context
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'checkpoint_delta', v_checkpoint_delta
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_batch_versioned(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_reason TEXT,
  p_expected_usage_version BIGINT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_version BIGINT := 0;
  v_item JSONB;
  v_checkpoint_delta NUMERIC := 0;
  v_checkpoint_total NUMERIC := 0;
  v_result JSONB;
BEGIN
  IF p_target_user_id IS NULL OR p_expected_usage_version IS NULL OR p_expected_usage_version < 0 THEN
    RAISE EXCEPTION 'invalid_usage_version' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'usage_adjustment_batch_required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
  VALUES (p_target_user_id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT version INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_version, 0) <> p_expected_usage_version THEN
    RAISE EXCEPTION 'usage_mutation_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Metered usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_checkpoint_delta := public.admin_checkpoint_legacy_usage_gap(
      p_target_user_id,
      v_item ->> 'metricKey',
      (v_item ->> 'windowStart')::timestamptz,
      NULLIF(v_item ->> 'windowEnd', '')::timestamptz,
      COALESCE((v_item ->> 'expectedAdjustmentTotal')::numeric, 0),
      v_item ->> 'requestId',
      COALESCE(v_item -> 'context', '{}'::jsonb)
    );
    v_checkpoint_total := v_checkpoint_total + COALESCE(v_checkpoint_delta, 0);
  END LOOP;

  v_result := public.admin_adjust_usage_batch_checked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    p_reason,
    p_items
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'checkpoint_total', v_checkpoint_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_usage_metric_aliases(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_usage_json_metric_value(JSONB, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_usage_tracked_value(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_checkpoint_legacy_usage_gap(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_usage_metric_aliases(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_usage_json_metric_value(JSONB, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_usage_tracked_value(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_checkpoint_legacy_usage_gap(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
