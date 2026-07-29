BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_ai_usage(
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT DEFAULT '',
  p_metric_increments JSONB DEFAULT '{}'::jsonb,
  p_limit_checks JSONB DEFAULT '[]'::jsonb,
  p_estimated_units INTEGER DEFAULT 1,
  p_ticket_id TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.ai_usage_reservations%ROWTYPE;
  v_today JSONB := '{}'::jsonb;
  v_total JSONB := '{}'::jsonb;
  v_usage_day DATE := (now() AT TIME ZONE 'UTC')::date;
  v_expires_at TIMESTAMPTZ := COALESCE(p_expires_at, now() + interval '15 minutes');
  v_request_fingerprint TEXT := TRIM(COALESCE(p_request_fingerprint, ''));
  v_check JSONB;
  v_metric_key TEXT;
  v_counter_scope TEXT;
  v_cap NUMERIC;
  v_current NUMERIC;
  v_increment NUMERIC;
  v_snapshot JSONB := '{}'::jsonb;
  v_reservation_id UUID;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_feature_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_feature_key is required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_route, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_route is required' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_idempotency_key is required' USING ERRCODE = '22023';
  END IF;
  IF p_metric_increments IS NULL OR jsonb_typeof(p_metric_increments) <> 'object' OR p_metric_increments = '{}'::jsonb THEN
    RAISE EXCEPTION 'p_metric_increments must be a non-empty object' USING ERRCODE = '22023';
  END IF;
  IF p_limit_checks IS NULL OR jsonb_typeof(p_limit_checks) <> 'array' THEN
    p_limit_checks := '[]'::jsonb;
  END IF;

  INSERT INTO public.usage_counters (user_id, day, counters)
  VALUES (p_user_id, v_usage_day, '{}'::jsonb)
  ON CONFLICT (user_id, day) DO NOTHING;

  INSERT INTO public.usage_totals (user_id, counters)
  VALUES (p_user_id, '{}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT counters
  INTO v_today
  FROM public.usage_counters
  WHERE user_id = p_user_id
    AND day = v_usage_day
  FOR UPDATE;

  SELECT counters
  INTO v_total
  FROM public.usage_totals
  WHERE user_id = p_user_id
  FOR UPDATE;

  SELECT *
  INTO v_existing
  FROM public.ai_usage_reservations
  WHERE user_id = p_user_id
    AND feature_key = p_feature_key
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'reserved' AND v_existing.expires_at <= now() THEN
      PERFORM public.increment_usage_counters(
        v_existing.user_id,
        public.ai_usage_negate_units(v_existing.reserved_units),
        v_existing.usage_day
      );

      UPDATE public.ai_usage_reservations
      SET status = 'expired',
          released_at = now(),
          failure_code = COALESCE(failure_code, 'expired_reservation'),
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_existing;
    END IF;

    IF v_existing.status = 'reserved' THEN
      IF COALESCE(NULLIF(v_existing.request_fingerprint, ''), v_request_fingerprint) <> v_request_fingerprint THEN
        RETURN jsonb_build_object(
          'ok', FALSE,
          'deduped', TRUE,
          'reservation_id', v_existing.id,
          'idempotency_key', v_existing.idempotency_key,
          'status', v_existing.status,
          'code', 'USAGE_RESERVATION_FINGERPRINT_MISMATCH'
        );
      END IF;

      UPDATE public.ai_usage_reservations
      SET ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
          expires_at = GREATEST(expires_at, v_expires_at),
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING * INTO v_existing;

      RETURN jsonb_build_object(
        'ok', TRUE,
        'deduped', TRUE,
        'reservation_id', v_existing.id,
        'idempotency_key', v_existing.idempotency_key,
        'status', v_existing.status,
        'expires_at', v_existing.expires_at
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', FALSE,
      'deduped', TRUE,
      'reservation_id', v_existing.id,
      'idempotency_key', v_existing.idempotency_key,
      'status', v_existing.status,
      'code', 'USAGE_RESERVATION_NOT_ACTIVE'
    );
  END IF;

  FOR v_check IN SELECT value FROM jsonb_array_elements(p_limit_checks)
  LOOP
    v_metric_key := NULLIF(TRIM(COALESCE(v_check ->> 'metric_key', '')), '');
    IF v_metric_key IS NULL OR NULLIF(TRIM(COALESCE(v_check ->> 'cap', '')), '') IS NULL THEN
      CONTINUE;
    END IF;

    v_counter_scope := LOWER(NULLIF(TRIM(COALESCE(v_check ->> 'counter_scope', '')), ''));
    IF v_counter_scope NOT IN ('today', 'total') THEN
      v_counter_scope := 'total';
    END IF;

    v_cap := (v_check ->> 'cap')::numeric;
    IF v_cap < 0 THEN
      v_cap := 0;
    END IF;

    v_increment := public.ai_usage_jsonb_numeric_value(p_metric_increments, v_metric_key);
    IF v_increment <= 0 THEN
      CONTINUE;
    END IF;

    IF v_counter_scope = 'today' THEN
      v_current := public.ai_usage_jsonb_numeric_value(COALESCE(v_today, '{}'::jsonb), v_metric_key);
    ELSE
      v_current := public.ai_usage_jsonb_numeric_value(COALESCE(v_total, '{}'::jsonb), v_metric_key);
    END IF;

    IF v_current + v_increment > v_cap THEN
      RETURN jsonb_build_object(
        'ok', FALSE,
        'code', 'USAGE_LIMIT_EXCEEDED',
        'metric_key', v_metric_key,
        'limit', v_cap,
        'current', v_current,
        'requested', v_increment,
        'status', 'rejected'
      );
    END IF;
  END LOOP;

  v_snapshot := public.increment_usage_counters(p_user_id, p_metric_increments, v_usage_day);

  INSERT INTO public.ai_usage_reservations (
    user_id,
    feature_key,
    route,
    idempotency_key,
    request_fingerprint,
    estimated_units,
    reserved_units,
    limit_checks,
    status,
    ticket_id,
    usage_day,
    expires_at
  )
  VALUES (
    p_user_id,
    TRIM(p_feature_key),
    TRIM(p_route),
    TRIM(p_idempotency_key),
    v_request_fingerprint,
    GREATEST(0, COALESCE(p_estimated_units, 1)),
    p_metric_increments,
    p_limit_checks,
    'reserved',
    NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''),
    v_usage_day,
    v_expires_at
  )
  RETURNING id INTO v_reservation_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'reservation_id', v_reservation_id,
    'idempotency_key', TRIM(p_idempotency_key),
    'status', 'reserved',
    'expires_at', v_expires_at,
    'snapshot', COALESCE(v_snapshot, '{}'::jsonb)
  );
END;
$$;

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
  v_row public.ai_usage_reservations%ROWTYPE;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  SELECT *
  INTO v_row
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
    PERFORM public.increment_usage_counters(v_row.user_id, public.ai_usage_negate_units(v_row.reserved_units), v_row.usage_day);
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

  IF v_row.provider_started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_REQUEST_IN_PROGRESS', 'status', v_row.status);
  END IF;

  UPDATE public.ai_usage_reservations
  SET provider_started_at = now(),
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

REVOKE ALL ON FUNCTION public.reserve_ai_usage(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_ai_usage(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_ai_usage_reservation(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
