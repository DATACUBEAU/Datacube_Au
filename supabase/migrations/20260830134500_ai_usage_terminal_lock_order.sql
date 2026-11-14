-- Keep every AI reservation lifecycle transition on one lock order.
--
-- reserve_ai_usage and commit_ai_usage serialize through:
--   daily usage counter -> lifetime usage total -> reservation.
-- release/begin-expiry/expiry cleanup historically took the reservation first and
-- then called increment_usage_counters, creating a deadlock cycle with commit.
-- Acquire accounting rows first, then re-read and validate the reservation under
-- FOR UPDATE before any terminal transition.

BEGIN;

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

  IF v_row.status = 'reserved' AND v_row.expires_at <= now() THEN
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

CREATE OR REPLACE FUNCTION public.release_ai_usage(
  p_reservation_id UUID,
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'released'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_probe public.ai_usage_reservations%ROWTYPE;
  v_row public.ai_usage_reservations%ROWTYPE;
  v_next_status TEXT := COALESCE(NULLIF(TRIM(COALESCE(p_status, '')), ''), 'released');
  v_snapshot JSONB := '{}'::jsonb;
  v_locked_today JSONB;
  v_locked_total JSONB;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF v_next_status NOT IN ('released', 'expired', 'disputed') THEN
    v_next_status := 'released';
  END IF;

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

  IF v_row.status IN ('committed', 'released', 'expired', 'disputed') THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'reservation_id', v_row.id,
      'idempotency_key', v_row.idempotency_key,
      'status', v_row.status
    );
  END IF;

  v_snapshot := public.increment_usage_counters(
    v_row.user_id,
    public.ai_usage_negate_units(v_row.reserved_units),
    v_row.usage_day
  );

  UPDATE public.ai_usage_reservations
  SET status = v_next_status,
      released_at = now(),
      ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
      failure_code = NULLIF(TRIM(COALESCE(p_failure_code, '')), ''),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key,
    'status', v_row.status,
    'snapshot', COALESCE(v_snapshot, '{}'::jsonb)
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
BEGIN
  PERFORM public.ai_usage_require_service_role();

  -- Candidate discovery intentionally takes no reservation row lock. All counter
  -- rows for this batch are acquired first in deterministic order; reservation
  -- rows are locked only afterward and their status/expiry is revalidated.
  SELECT COALESCE(array_agg(candidate.id ORDER BY candidate.user_id, candidate.usage_day, candidate.expires_at, candidate.id), ARRAY[]::UUID[])
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

REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_ai_usage_reservations(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_ai_usage_reservations(INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_ai_usage_reservations(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
