-- Preserve provider-started settlement leases while retaining the canonical
-- per-user accounting serialization added by 20260901124500.
--
-- The expiry reaper may only terminalize a reserved row after both its raw TTL
-- and its bounded provider settlement lease have elapsed. Candidate discovery
-- keeps the raw expires_at predicate as an indexed necessary prefilter, then
-- evaluates the authoritative effective expiry. Rows are revalidated with a
-- fresh wall-clock timestamp after all accounting locks are acquired.

BEGIN;

CREATE OR REPLACE FUNCTION public.expire_ai_usage_reservations(p_limit INTEGER DEFAULT 500)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
  v_count INTEGER := 0;
  v_candidate_ids UUID[] := ARRAY[]::UUID[];
  v_key RECORD;
  v_id UUID;
  v_row public.ai_usage_reservations%ROWTYPE;
  v_locked_today JSONB;
  v_locked_total JSONB;
  v_scan_at TIMESTAMPTZ := clock_timestamp();
  v_recheck_at TIMESTAMPTZ;
  v_effective_expiry TIMESTAMPTZ;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  -- expires_at <= v_scan_at preserves the existing (status, expires_at) index
  -- as a cheap necessary prefilter. A provider-started row is eligible only
  -- when the authoritative effective lease has also elapsed.
  SELECT COALESCE(
    array_agg(candidate.id ORDER BY candidate.user_id, candidate.usage_day, candidate.effective_expiry, candidate.id),
    ARRAY[]::UUID[]
  )
  INTO v_candidate_ids
  FROM (
    SELECT
      id,
      user_id,
      usage_day,
      public.ai_usage_reservation_effective_expiry(expires_at, provider_started_at) AS effective_expiry
    FROM public.ai_usage_reservations
    WHERE status = 'reserved'
      AND expires_at <= v_scan_at
      AND public.ai_usage_reservation_effective_expiry(expires_at, provider_started_at) <= v_scan_at
    ORDER BY user_id, usage_day, effective_expiry, id
    LIMIT v_limit
  ) AS candidate;

  IF cardinality(v_candidate_ids) = 0 THEN
    RETURN jsonb_build_object('ok', TRUE, 'expired', 0);
  END IF;

  -- Acquire the same per-user accounting boundary used by admission,
  -- begin/commit/release, and admin corrections before any counter row work.
  FOR v_key IN
    SELECT DISTINCT r.user_id
    FROM public.ai_usage_reservations r
    WHERE r.id = ANY(v_candidate_ids)
    ORDER BY r.user_id
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(concat_ws('|', 'usage_accounting_user', v_key.user_id::TEXT), 0)
    );
  END LOOP;

  INSERT INTO public.usage_counters (user_id, day, counters)
  SELECT DISTINCT r.user_id, r.usage_day, '{}'::jsonb
  FROM public.ai_usage_reservations r
  WHERE r.id = ANY(v_candidate_ids)
  ORDER BY r.user_id, r.usage_day
  ON CONFLICT (user_id, day) DO NOTHING;

  INSERT INTO public.usage_totals (user_id, counters)
  SELECT DISTINCT r.user_id, '{}'::jsonb
  FROM public.ai_usage_reservations r
  WHERE r.id = ANY(v_candidate_ids)
  ORDER BY r.user_id
  ON CONFLICT (user_id) DO NOTHING;

  FOR v_key IN
    SELECT DISTINCT r.user_id, r.usage_day
    FROM public.ai_usage_reservations r
    WHERE r.id = ANY(v_candidate_ids)
    ORDER BY r.user_id, r.usage_day
  LOOP
    SELECT counters INTO v_locked_today
    FROM public.usage_counters
    WHERE user_id = v_key.user_id AND day = v_key.usage_day
    FOR UPDATE;
  END LOOP;

  FOR v_key IN
    SELECT DISTINCT r.user_id
    FROM public.ai_usage_reservations r
    WHERE r.id = ANY(v_candidate_ids)
    ORDER BY r.user_id
  LOOP
    SELECT counters INTO v_locked_total
    FROM public.usage_totals
    WHERE user_id = v_key.user_id
    FOR UPDATE;
  END LOOP;

  FOREACH v_id IN ARRAY v_candidate_ids
  LOOP
    SELECT * INTO v_row
    FROM public.ai_usage_reservations
    WHERE id = v_id
    FOR UPDATE;

    IF NOT FOUND OR v_row.status <> 'reserved' THEN
      CONTINUE;
    END IF;

    -- A lock wait can cross the raw/effective lease boundary. Re-evaluate with
    -- wall-clock time only after serialization so genuinely active work cannot
    -- be expired by a stale transaction timestamp.
    v_recheck_at := clock_timestamp();
    v_effective_expiry := public.ai_usage_reservation_effective_expiry(
      v_row.expires_at,
      v_row.provider_started_at
    );

    IF v_row.expires_at > v_recheck_at OR v_effective_expiry > v_recheck_at THEN
      CONTINUE;
    END IF;

    PERFORM public.increment_usage_counters(
      v_row.user_id,
      public.ai_usage_negate_units(v_row.reserved_units),
      v_row.usage_day
    );

    UPDATE public.ai_usage_reservations
    SET status = 'expired',
        released_at = v_recheck_at,
        failure_code = COALESCE(failure_code, 'expired_reservation'),
        updated_at = v_recheck_at
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'expired', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_ai_usage_reservations(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_ai_usage_reservations(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
