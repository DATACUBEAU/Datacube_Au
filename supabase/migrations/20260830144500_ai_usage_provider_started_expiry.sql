-- Keep provider-started AI work represented in authoritative usage until it has
-- had a bounded terminal-settlement lease. The ticket may be consumed near the
-- reservation TTL boundary, so expiring solely on the original expires_at can
-- temporarily remove real in-flight cost from quota enforcement.
--
-- A started provider attempt receives a 15-minute settlement lease from
-- provider_started_at. This is intentionally bounded so crashed workers cannot
-- pin quota forever. Explicit commit/release still settles immediately.

BEGIN;

CREATE OR REPLACE FUNCTION public.ai_usage_reservation_effective_expiry(
  p_expires_at TIMESTAMPTZ,
  p_provider_started_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_provider_started_at IS NULL THEN p_expires_at
    ELSE GREATEST(p_expires_at, p_provider_started_at + interval '15 minutes')
  END;
$$;

REVOKE ALL ON FUNCTION public.ai_usage_reservation_effective_expiry(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_reservation_effective_expiry(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.begin_ai_usage_reservation(
  p_reservation_id UUID,
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_probe public.ai_usage_reservations%ROWTYPE;
  v_row public.ai_usage_reservations%ROWTYPE;
  v_locked_today JSONB;
  v_locked_total JSONB;
  v_effective_expiry TIMESTAMPTZ;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  SELECT * INTO v_probe
  FROM public.ai_usage_reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_FOUND', 'status', 'missing');
  END IF;

  IF v_probe.user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_CLAIM_MISMATCH', 'status', v_probe.status);
  END IF;

  INSERT INTO public.usage_counters (user_id, day, counters)
  VALUES (p_user_id, v_probe.usage_day, '{}'::jsonb)
  ON CONFLICT (user_id, day) DO NOTHING;

  INSERT INTO public.usage_totals (user_id, counters)
  VALUES (p_user_id, '{}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT counters INTO v_locked_today
  FROM public.usage_counters
  WHERE user_id = p_user_id AND day = v_probe.usage_day
  FOR UPDATE;

  SELECT counters INTO v_locked_total
  FROM public.usage_totals
  WHERE user_id = p_user_id
  FOR UPDATE;

  SELECT * INTO v_row
  FROM public.ai_usage_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_FOUND', 'status', 'missing');
  END IF;

  IF v_row.user_id <> p_user_id
    OR v_row.feature_key <> p_feature_key
    OR v_row.route <> p_route
    OR v_row.idempotency_key <> p_idempotency_key THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_CLAIM_MISMATCH', 'status', v_row.status);
  END IF;

  v_effective_expiry := public.ai_usage_reservation_effective_expiry(
    v_row.expires_at,
    v_row.provider_started_at
  );

  IF v_row.status = 'reserved' AND v_effective_expiry <= now() THEN
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
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_ACTIVE', 'status', v_row.status);
  END IF;

  IF v_row.provider_started_at IS NOT NULL
    AND v_row.provider_started_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_REQUEST_IN_PROGRESS', 'status', v_row.status);
  END IF;

  UPDATE public.ai_usage_reservations
  SET provider_started_at = COALESCE(provider_started_at, now()),
      last_attempt_at = now(),
      attempt_count = attempt_count + 1,
      provider = COALESCE(NULLIF(TRIM(COALESCE(p_provider, '')), ''), provider),
      model = COALESCE(NULLIF(TRIM(COALESCE(p_model, '')), ''), model),
      ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count
  );
END;
$$;

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
  v_effective_expiry TIMESTAMPTZ;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.user_id, candidate.usage_day, candidate.effective_expiry, candidate.id), ARRAY[]::UUID[])
  INTO v_candidate_ids
  FROM (
    SELECT
      id,
      user_id,
      usage_day,
      public.ai_usage_reservation_effective_expiry(expires_at, provider_started_at) AS effective_expiry
    FROM public.ai_usage_reservations
    WHERE status = 'reserved'
      AND public.ai_usage_reservation_effective_expiry(expires_at, provider_started_at) <= now()
    ORDER BY user_id, usage_day, effective_expiry, id
    LIMIT v_limit
  ) AS candidate;

  IF cardinality(v_candidate_ids) = 0 THEN
    RETURN jsonb_build_object('ok', TRUE, 'expired', 0);
  END IF;

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

    v_effective_expiry := public.ai_usage_reservation_effective_expiry(
      v_row.expires_at,
      v_row.provider_started_at
    );

    IF v_effective_expiry > now() THEN
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

-- A target-style correction must not be based on any provisional reservation.
-- Even a row past its nominal expires_at remains part of counters until an
-- explicit terminal transition removes it, and provider-started rows now have
-- a bounded effective-expiry lease.
CREATE OR REPLACE FUNCTION public.assert_no_active_ai_usage_reservation(
  p_user_id UUID,
  p_metric_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ai_usage_reservations r
    WHERE r.user_id = p_user_id
      AND r.status = 'reserved'
      AND COALESCE((r.reserved_units ->> p_metric_key)::NUMERIC, 0) > 0
  ) THEN
    RAISE EXCEPTION 'usage_reservation_in_flight'
      USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_ai_usage_reservations(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_no_active_ai_usage_reservation(UUID, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_ai_usage_reservations(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
