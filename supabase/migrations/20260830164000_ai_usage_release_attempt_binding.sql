-- Prevent an older provider attempt from releasing a newer takeover's reservation.
-- Terminal release keeps the established daily counter -> lifetime total -> reservation
-- lock order, then validates the caller ticket against the ticket currently bound to
-- the active reservation before subtracting any reserved usage.

BEGIN;

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
  v_ticket_id TEXT := NULLIF(TRIM(COALESCE(p_ticket_id, '')), '');
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

  -- A provider attempt is identified by the ticket accepted by
  -- begin_ai_usage_reservation. Once a takeover replaces ticket_id, an older
  -- attempt must not be able to release the newer attempt's still-active units.
  IF v_row.status = 'reserved'
    AND v_row.ticket_id IS NOT NULL
    AND (v_ticket_id IS NULL OR v_ticket_id IS DISTINCT FROM v_row.ticket_id) THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'USAGE_RESERVATION_ATTEMPT_MISMATCH',
      'reservation_id', v_row.id,
      'idempotency_key', v_row.idempotency_key,
      'status', v_row.status
    );
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

REVOKE ALL ON FUNCTION public.release_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
