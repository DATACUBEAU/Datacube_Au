-- Prevent a later provider takeover from reusing quota admitted in an expired finite window.
--
-- Exact reservation replays intentionally survive reset boundaries so a caller can recover
-- a lost reservation response. That must not also permit a genuinely new provider attempt
-- to begin after the reservation's original daily/hourly/weekly/monthly/custom window has
-- ended. A takeover uses a new ticket and represents new provider work, so require every
-- finite authoritative limit window captured on the reservation to still be active at the
-- serialized provider-start boundary. Rolling-deploy reservations without window metadata
-- retain their existing compatibility behavior.

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
  v_effective_expiry TIMESTAMPTZ;
  v_attempt_started_at TIMESTAMPTZ;
  v_incoming_ticket_id TEXT;
  v_wall_clock_now TIMESTAMPTZ;
  v_limit_check JSONB;
  v_limit_scope TEXT;
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
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

  -- Freshness is evaluated only after daily -> lifetime -> reservation serialization.
  v_wall_clock_now := clock_timestamp();

  v_effective_expiry := public.ai_usage_reservation_effective_expiry(
    v_row.expires_at,
    v_row.provider_started_at
  );

  IF v_row.status = 'reserved' AND v_effective_expiry <= v_wall_clock_now THEN
    PERFORM public.increment_usage_counters(
      v_row.user_id,
      public.ai_usage_negate_units(v_row.reserved_units),
      v_row.usage_day
    );
    UPDATE public.ai_usage_reservations
    SET status = 'expired',
        released_at = v_wall_clock_now,
        failure_code = COALESCE(failure_code, 'expired_reservation'),
        updated_at = v_wall_clock_now
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  IF v_row.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_ACTIVE', 'status', v_row.status);
  END IF;

  v_incoming_ticket_id := NULLIF(TRIM(COALESCE(p_ticket_id, '')), '');

  IF v_row.last_attempt_at IS NOT NULL
    AND v_incoming_ticket_id IS NOT NULL
    AND v_row.ticket_id IS NOT NULL
    AND v_incoming_ticket_id = v_row.ticket_id THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'USAGE_PROVIDER_TICKET_ALREADY_ACCEPTED',
      'status', v_row.status
    );
  END IF;

  IF v_row.last_attempt_at IS NOT NULL
    AND v_row.last_attempt_at > v_wall_clock_now - interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_REQUEST_IN_PROGRESS', 'status', v_row.status);
  END IF;

  -- A different ticket after the cooldown is a genuinely new provider attempt. It may
  -- reuse the existing reservation only while the finite quota windows under which that
  -- reservation was admitted are still authoritative. Lifetime checks have no end bound
  -- and rolling-deploy rows can omit window metadata, so both preserve compatibility.
  IF v_row.last_attempt_at IS NOT NULL THEN
    FOR v_limit_check IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(v_row.limit_checks, '[]'::jsonb))
    LOOP
      v_limit_scope := LOWER(NULLIF(TRIM(COALESCE(v_limit_check ->> 'scope', '')), ''));
      IF v_limit_scope NOT IN ('canonical_plan', 'tier_quota') THEN
        CONTINUE;
      END IF;

      v_window_start := CASE
        WHEN NULLIF(TRIM(COALESCE(v_limit_check ->> 'window_start', '')), '') IS NULL THEN NULL
        ELSE (v_limit_check ->> 'window_start')::TIMESTAMPTZ
      END;
      v_window_end := CASE
        WHEN NULLIF(TRIM(COALESCE(v_limit_check ->> 'window_end', '')), '') IS NULL THEN NULL
        ELSE (v_limit_check ->> 'window_end')::TIMESTAMPTZ
      END;

      IF v_window_start IS NOT NULL
        AND v_window_end IS NOT NULL
        AND (v_wall_clock_now < v_window_start OR v_wall_clock_now >= v_window_end) THEN
        RETURN jsonb_build_object(
          'ok', FALSE,
          'code', 'USAGE_PROVIDER_TAKEOVER_WINDOW_STALE',
          'status', v_row.status,
          'metric_key', NULLIF(TRIM(COALESCE(v_limit_check ->> 'metric_key', '')), '')
        );
      END IF;
    END LOOP;
  END IF;

  v_attempt_started_at := v_wall_clock_now;

  UPDATE public.ai_usage_reservations
  SET provider_started_at = COALESCE(provider_started_at, v_attempt_started_at),
      last_attempt_at = v_attempt_started_at,
      expires_at = GREATEST(expires_at, v_attempt_started_at + interval '15 minutes'),
      attempt_count = attempt_count + 1,
      provider = COALESCE(NULLIF(TRIM(COALESCE(p_provider, '')), ''), provider),
      model = COALESCE(NULLIF(TRIM(COALESCE(p_model, '')), ''), model),
      ticket_id = COALESCE(v_incoming_ticket_id, ticket_id),
      updated_at = v_attempt_started_at
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count,
    'expires_at', v_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
