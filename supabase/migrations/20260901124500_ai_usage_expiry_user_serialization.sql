-- Bring the multi-user AI reservation expiry reaper under the same canonical
-- per-user accounting serialization boundary used by admission, begin/commit/
-- release, and admin usage corrections.
--
-- Candidate discovery remains lock-free. Once the bounded candidate set is
-- known, acquire every affected user's transaction advisory lock in stable UUID
-- order before creating or locking usage counters/reservations. Rows are still
-- re-read under FOR UPDATE before expiry, so waiting for another same-user
-- accounting transaction cannot make a stale candidate expire incorrectly.

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
BEGIN
  PERFORM public.ai_usage_require_service_role();

  -- Candidate discovery intentionally takes no reservation row lock. The set is
  -- bounded and every candidate is revalidated later under FOR UPDATE.
  SELECT COALESCE(
    array_agg(candidate.id ORDER BY candidate.user_id, candidate.usage_day, candidate.expires_at, candidate.id),
    ARRAY[]::UUID[]
  )
  INTO v_candidate_ids
  FROM (
    SELECT id, user_id, usage_day, expires_at
    FROM public.ai_usage_reservations
    WHERE status = 'reserved'
      AND expires_at <= now()
    ORDER BY user_id, usage_day, expires_at, id
    LIMIT v_limit
  ) AS candidate;

  IF cardinality(v_candidate_ids) = 0 THEN
    RETURN jsonb_build_object('ok', TRUE, 'expired', 0);
  END IF;

  -- Canonical outer accounting boundary. Stable ordering prevents two expiry
  -- batches with overlapping user sets from deadlocking each other while also
  -- serializing against interactive AI lifecycle and admin correction paths.
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

    IF NOT FOUND OR v_row.status <> 'reserved' OR v_row.expires_at > now() THEN
      CONTINUE;
    END IF;

    PERFORM public.increment_usage_counters(
      v_row.user_id,
      public.ai_usage_negate_units(v_row.reserved_units),
      v_row.usage_day
    );

    UPDATE public.ai_usage_reservations
    SET status = 'expired',
        released_at = now(),
        failure_code = COALESCE(failure_code, 'expired_reservation'),
        updated_at = now()
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
