-- Bind every new admin usage adjustment to the currently persisted usage-rule
-- window for the effective plan supplied by the authoritative server snapshot.
--
-- The API already re-reads entitlements immediately before mutation, but a plan
-- rule can still change after that read and before the append-only adjustment is
-- inserted. Serialize plan-rule writes and adjustment inserts on the same
-- scope/metric advisory keys, then derive the exact UTC reset window from the
-- locked canonical rule row. Completed idempotent replays do not insert a new
-- ledger row, so they remain recoverable after later rule changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.lock_plan_limit_rule_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_key TEXT := NULL;
  v_new_key TEXT := NULL;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_key := concat_ws('|', 'plan_limit_rule', OLD.scope, OLD.limit_key);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_key := concat_ws('|', 'plan_limit_rule', NEW.scope, NEW.limit_key);
  END IF;

  IF v_old_key IS NOT NULL AND v_new_key IS NOT NULL AND v_old_key <> v_new_key THEN
    IF v_old_key < v_new_key THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(v_old_key, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended(v_new_key, 0));
    ELSE
      PERFORM pg_advisory_xact_lock(hashtextextended(v_new_key, 0));
      PERFORM pg_advisory_xact_lock(hashtextextended(v_old_key, 0));
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(v_new_key, v_old_key), 0));
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_au_plan_limit_rules_serialize_write
ON public.au_plan_limit_rules;

CREATE TRIGGER trg_au_plan_limit_rules_serialize_write
BEFORE INSERT OR UPDATE OR DELETE
ON public.au_plan_limit_rules
FOR EACH ROW
EXECUTE FUNCTION public.lock_plan_limit_rule_write();

CREATE OR REPLACE FUNCTION public.assert_admin_usage_adjustment_live_plan_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan TEXT := LOWER(NULLIF(TRIM(COALESCE(NEW.context ->> 'effective_plan', '')), ''));
  v_plan_lock_key TEXT;
  v_default_lock_key TEXT;
  v_rule public.au_plan_limit_rules%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_expected_start TIMESTAMPTZ;
  v_expected_end TIMESTAMPTZ;
  v_every INTEGER;
  v_bucket_seconds NUMERIC;
  v_epoch TIMESTAMPTZ := TIMESTAMPTZ '1970-01-01 00:00:00+00';
  v_week_epoch TIMESTAMPTZ := TIMESTAMPTZ '1970-01-05 00:00:00+00';
  v_month_index INTEGER;
  v_start_month_index INTEGER;
BEGIN
  IF v_plan NOT IN ('free', 'pro', 'premium') THEN
    RAISE EXCEPTION 'usage_adjustment_effective_plan_required'
      USING ERRCODE = '22023',
            DETAIL = 'New usage corrections require the authoritative effective plan.';
  END IF;

  -- Lock both the selected plan scope and its default fallback before resolving
  -- inheritance. The matching write trigger uses the same keys, preventing an
  -- override insert/update/delete from racing this transaction after resolution.
  v_default_lock_key := concat_ws('|', 'plan_limit_rule', 'default', NEW.metric_key);
  v_plan_lock_key := concat_ws('|', 'plan_limit_rule', v_plan, NEW.metric_key);

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
  WHERE r.limit_key = NEW.metric_key
    AND r.scope IN (v_plan, 'default')
  ORDER BY CASE WHEN r.scope = v_plan THEN 0 ELSE 1 END
  LIMIT 1
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'usage_adjustment_effective_rule_missing'
      USING ERRCODE = '40001',
            DETAIL = 'The effective plan rule changed before the usage correction was committed. Refresh and retry.';
  END IF;

  IF v_rule.mode <> 'usage' OR NOT v_rule.is_enabled THEN
    RAISE EXCEPTION 'usage_adjustment_rule_not_adjustable'
      USING ERRCODE = '40001',
            DETAIL = 'The usage rule is no longer adjustable. Refresh and retry.';
  END IF;

  IF v_rule.reset_policy = 'never' THEN
    v_expected_start := v_epoch;
    v_expected_end := NULL;
  ELSIF v_rule.reset_policy = 'hourly' THEN
    v_expected_start := date_trunc('hour', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_expected_end := v_expected_start + INTERVAL '1 hour';
  ELSIF v_rule.reset_policy = 'daily' THEN
    v_expected_start := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_expected_end := v_expected_start + INTERVAL '1 day';
  ELSIF v_rule.reset_policy = 'weekly' THEN
    v_expected_start := date_trunc('week', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_expected_end := v_expected_start + INTERVAL '1 week';
  ELSIF v_rule.reset_policy = 'monthly' THEN
    v_expected_start := date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_expected_end := v_expected_start + INTERVAL '1 month';
  ELSIF v_rule.reset_policy = 'custom' THEN
    v_every := GREATEST(1, COALESCE(v_rule.reset_interval_value, 1));

    IF v_rule.reset_interval_unit = 'hour' THEN
      v_bucket_seconds := 3600::NUMERIC * v_every;
      v_expected_start := v_epoch
        + make_interval(secs => (floor(extract(epoch FROM v_now) / v_bucket_seconds) * v_bucket_seconds)::DOUBLE PRECISION);
      v_expected_end := v_expected_start + make_interval(hours => v_every);
    ELSIF v_rule.reset_interval_unit = 'day' THEN
      v_bucket_seconds := 86400::NUMERIC * v_every;
      v_expected_start := v_epoch
        + make_interval(secs => (floor(extract(epoch FROM v_now) / v_bucket_seconds) * v_bucket_seconds)::DOUBLE PRECISION);
      v_expected_end := v_expected_start + make_interval(days => v_every);
    ELSIF v_rule.reset_interval_unit = 'week' THEN
      v_bucket_seconds := 604800::NUMERIC * v_every;
      v_expected_start := v_week_epoch
        + make_interval(secs => (floor(extract(epoch FROM (v_now - v_week_epoch)) / v_bucket_seconds) * v_bucket_seconds)::DOUBLE PRECISION);
      v_expected_end := v_expected_start + make_interval(weeks => v_every);
    ELSIF v_rule.reset_interval_unit = 'month' THEN
      v_month_index := ((extract(year FROM (v_now AT TIME ZONE 'UTC'))::INTEGER - 1970) * 12)
        + extract(month FROM (v_now AT TIME ZONE 'UTC'))::INTEGER - 1;
      v_start_month_index := v_month_index - mod(v_month_index, v_every);
      v_expected_start := make_timestamptz(
        1970 + (v_start_month_index / 12),
        mod(v_start_month_index, 12) + 1,
        1,
        0,
        0,
        0,
        'UTC'
      );
      v_expected_end := v_expected_start + make_interval(months => v_every);
    ELSE
      RAISE EXCEPTION 'usage_adjustment_effective_rule_invalid'
        USING ERRCODE = '40001',
              DETAIL = 'The effective plan rule has an invalid custom reset interval.';
    END IF;
  ELSE
    RAISE EXCEPTION 'usage_adjustment_effective_rule_invalid'
      USING ERRCODE = '40001',
            DETAIL = 'The effective plan rule has an unsupported reset policy.';
  END IF;

  IF NEW.window_start IS DISTINCT FROM v_expected_start
     OR NEW.window_end IS DISTINCT FROM v_expected_end
  THEN
    RAISE EXCEPTION 'usage_adjustment_rule_window_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'The active quota window changed before the usage correction was committed. Refresh and retry.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_au_usage_admin_adjustments_live_plan_rule
ON public.au_usage_admin_adjustments;

CREATE TRIGGER trg_au_usage_admin_adjustments_live_plan_rule
BEFORE INSERT
ON public.au_usage_admin_adjustments
FOR EACH ROW
EXECUTE FUNCTION public.assert_admin_usage_adjustment_live_plan_rule();

REVOKE ALL ON FUNCTION public.lock_plan_limit_rule_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_admin_usage_adjustment_live_plan_rule() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_plan_limit_rule_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_admin_usage_adjustment_live_plan_rule() TO service_role;

COMMIT;