-- Align legacy/hybrid checkpoint source selection with the canonical plan rule.
--
-- The original checkpoint helper inferred daily accounting solely from a UTC-aligned
-- 24-hour window. A custom one-day rule can have the same bounds while canonical
-- usage intentionally reconstructs custom windows from the append-only event ledger.
-- Resolve and lock the same effective plan rule used by quota enforcement, then use
-- counters only for explicit daily/lifetime policies and events for every other
-- finite policy. This keeps checkpointing on the existing entitlement source of truth.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_usage_tracked_value_for_effective_rule(
  p_user_id UUID,
  p_metric_key TEXT,
  p_effective_plan TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT := LOWER(NULLIF(TRIM(COALESCE(p_effective_plan, '')), ''));
  v_plan_lock_key TEXT;
  v_default_lock_key TEXT;
  v_rule public.au_plan_limit_rules%ROWTYPE;
  v_aliases TEXT[] := public.admin_usage_metric_aliases(p_metric_key);
  v_counters JSONB := '{}'::jsonb;
  v_window_totals JSONB := '{}'::jsonb;
  v_expected_daily_start TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL OR p_window_start IS NULL THEN
    RETURN 0;
  END IF;

  IF v_plan NOT IN ('free', 'pro', 'premium') THEN
    RAISE EXCEPTION 'usage_checkpoint_effective_plan_required'
      USING ERRCODE = '22023',
            DETAIL = 'Legacy usage checkpointing requires the authoritative effective plan.';
  END IF;

  -- Use the same rule-write serialization identity as the adjustment ledger guard so
  -- the reset policy cannot change between checkpoint source selection and insertion.
  v_default_lock_key := concat_ws('|', 'plan_limit_rule', 'default', TRIM(p_metric_key));
  v_plan_lock_key := concat_ws('|', 'plan_limit_rule', v_plan, TRIM(p_metric_key));

  IF v_default_lock_key < v_plan_lock_key THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_default_lock_key, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(v_plan_lock_key, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(v_plan_lock_key, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(v_default_lock_key, 0));
  END IF;

  SELECT r.*
  INTO v_rule
  FROM public.au_plan_limit_rules AS r
  WHERE r.limit_key = TRIM(p_metric_key)
    AND r.scope IN (v_plan, 'default')
  ORDER BY CASE WHEN r.scope = v_plan THEN 0 ELSE 1 END
  LIMIT 1
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'usage_checkpoint_effective_rule_missing'
      USING ERRCODE = '40001',
            DETAIL = 'The effective plan rule changed before usage checkpointing. Refresh and retry.';
  END IF;

  IF v_rule.mode <> 'usage' OR NOT v_rule.is_enabled THEN
    RAISE EXCEPTION 'usage_checkpoint_rule_not_adjustable'
      USING ERRCODE = '40001',
            DETAIL = 'The usage rule is no longer adjustable. Refresh and retry.';
  END IF;

  -- Lifetime usage is authoritative in usage_totals. This includes reservation
  -- mutations that do not necessarily have a matching usage-event row yet.
  IF v_rule.reset_policy = 'never' THEN
    IF p_window_end IS NOT NULL
       OR p_window_start IS DISTINCT FROM TIMESTAMPTZ '1970-01-01 00:00:00+00'
    THEN
      RAISE EXCEPTION 'usage_checkpoint_rule_window_conflict'
        USING ERRCODE = '40001',
              DETAIL = 'The supplied lifetime usage window no longer matches the effective rule.';
    END IF;

    SELECT counters INTO v_counters
    FROM public.usage_totals
    WHERE user_id = p_user_id;

    RETURN GREATEST(0, public.admin_usage_json_metric_value(v_counters, v_aliases));
  END IF;

  -- Only an explicit daily rule may use usage_counters. A custom one-day interval
  -- deliberately falls through to the event-ledger path below, matching the canonical
  -- resolver rather than being inferred from equal-looking window bounds.
  IF v_rule.reset_policy = 'daily' THEN
    v_expected_daily_start := date_trunc('day', p_window_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    IF p_window_start IS DISTINCT FROM v_expected_daily_start
       OR p_window_end IS DISTINCT FROM p_window_start + INTERVAL '1 day'
    THEN
      RAISE EXCEPTION 'usage_checkpoint_rule_window_conflict'
        USING ERRCODE = '40001',
              DETAIL = 'The supplied daily usage window no longer matches the effective rule.';
    END IF;

    SELECT counters INTO v_counters
    FROM public.usage_counters
    WHERE user_id = p_user_id
      AND day = (p_window_start AT TIME ZONE 'UTC')::date;

    RETURN GREATEST(0, public.admin_usage_json_metric_value(v_counters, v_aliases));
  END IF;

  -- Hourly, weekly, monthly, and every custom interval are reconstructed from the
  -- append-only event ledger for the exact active window, matching canonical usage.
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
  v_effective_plan TEXT := NULLIF(TRIM(COALESCE(p_context ->> 'effective_plan', '')), '');
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

  IF v_previous_effective <= 0 THEN
    RETURN 0;
  END IF;

  v_base_used := GREATEST(0, v_previous_effective - COALESCE(p_expected_adjustment_total, 0));
  v_tracked_used := public.admin_usage_tracked_value_for_effective_rule(
    p_target_user_id,
    p_metric_key,
    v_effective_plan,
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
      'base_before', v_base_used,
      'effective_plan', LOWER(v_effective_plan)
    ),
    clock_timestamp()
  );

  RETURN v_checkpoint_delta;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_usage_tracked_value_for_effective_rule(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_tracked_value_for_effective_rule(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
TO service_role;

-- Keep the existing checkpoint helper internal to the trusted usage mutation path.
REVOKE ALL ON FUNCTION public.admin_checkpoint_legacy_usage_gap(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, TEXT, JSONB)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_checkpoint_legacy_usage_gap(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC, TEXT, JSONB)
TO service_role;

COMMIT;
