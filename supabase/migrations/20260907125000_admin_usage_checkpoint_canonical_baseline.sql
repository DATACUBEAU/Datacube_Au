-- Materialize legacy/hybrid checkpoint baselines into the canonical metric key.
--
-- Canonical usage resolution accepts historical aliases, but once a canonical key exists it
-- intentionally takes precedence. A checkpoint that computes its gap against an alias-backed
-- tracked value and then writes only that gap under the canonical key can therefore leave the
-- canonical value below the reconstructed baseline. Resolve the authoritative reset source as
-- before, but compare the legacy baseline against the canonical key already materialized in that
-- source. The checkpoint event then brings the canonical key all the way to the reconstructed
-- baseline without deleting or double-counting historical alias rows/events.

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
  v_metric_key TEXT := TRIM(COALESCE(p_metric_key, ''));
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

  IF v_metric_key = '' THEN
    RAISE EXCEPTION 'usage_checkpoint_metric_required'
      USING ERRCODE = '22023';
  END IF;

  IF v_plan NOT IN ('free', 'pro', 'premium') THEN
    RAISE EXCEPTION 'usage_checkpoint_effective_plan_required'
      USING ERRCODE = '22023',
            DETAIL = 'Legacy usage checkpointing requires the authoritative effective plan.';
  END IF;

  -- Preserve the canonical rule-write serialization introduced by the reset-policy guard.
  v_default_lock_key := concat_ws('|', 'plan_limit_rule', 'default', v_metric_key);
  v_plan_lock_key := concat_ws('|', 'plan_limit_rule', v_plan, v_metric_key);

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
  WHERE r.limit_key = v_metric_key
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

    -- Compare against the canonical key only. Historical aliases remain readable, but the
    -- checkpoint must materialize the complete reconstructed baseline under this key.
    RETURN GREATEST(
      0,
      public.admin_usage_json_metric_value(v_counters, ARRAY[v_metric_key]::TEXT[])
    );
  END IF;

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

    RETURN GREATEST(
      0,
      public.admin_usage_json_metric_value(v_counters, ARRAY[v_metric_key]::TEXT[])
    );
  END IF;

  -- Query every accepted alias so historical events remain visible while reconstructing the
  -- window, but use only the canonical bucket as the already-materialized amount. The existing
  -- checkpoint event writes the missing remainder to the canonical key.
  v_window_totals := public.get_usage_metric_window_totals(
    p_user_id,
    v_aliases,
    p_window_start,
    p_window_end
  );

  RETURN GREATEST(
    0,
    public.admin_usage_json_metric_value(v_window_totals, ARRAY[v_metric_key]::TEXT[])
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_usage_tracked_value_for_effective_rule(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_tracked_value_for_effective_rule(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
TO service_role;

COMMIT;
