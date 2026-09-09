-- Serialize AI usage commits with authoritative reservation snapshots.
--
-- Window-scoped quota enforcement reconstructs committed usage from au_usage_events
-- plus live ai_usage_reservations. Under READ COMMITTED, a commit that changes a
-- reservation from `reserved` to `committed` between those two reads can disappear
-- from both snapshots. Acquire the same per-user counter locks, in the same order,
-- before locking/mutating the reservation so reserve_ai_usage cannot interleave its
-- event/reservation snapshot with a commit transition.

BEGIN;

CREATE OR REPLACE FUNCTION public.commit_ai_usage(
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
  v_event_id UUID;
  v_event_key TEXT;
  v_locked_today JSONB;
  v_locked_total JSONB;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  -- Read only enough immutable ownership/day information to acquire locks in the
  -- same order as reserve_ai_usage: daily counter -> lifetime total -> reservation.
  -- This probe is intentionally not trusted for the commit decision; the locked
  -- reservation row is re-read and fully validated below.
  SELECT *
  INTO v_probe
  FROM public.ai_usage_reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_FOUND', 'status', 'missing');
  END IF;

  IF v_probe.user_id <> p_user_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_CLAIM_MISMATCH', 'status', v_probe.status);
  END IF;

  SELECT counters
  INTO v_locked_today
  FROM public.usage_counters
  WHERE user_id = p_user_id
    AND day = v_probe.usage_day
  FOR UPDATE;

  SELECT counters
  INTO v_locked_total
  FROM public.usage_totals
  WHERE user_id = p_user_id
  FOR UPDATE;

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

  IF v_row.status = 'committed' THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'reservation_id', v_row.id,
      'idempotency_key', v_row.idempotency_key,
      'status', v_row.status
    );
  END IF;

  IF v_row.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_ACTIVE', 'status', v_row.status);
  END IF;

  UPDATE public.ai_usage_reservations
  SET status = 'committed',
      committed_units = reserved_units,
      provider = COALESCE(NULLIF(TRIM(COALESCE(p_provider, '')), ''), provider),
      model = COALESCE(NULLIF(TRIM(COALESCE(p_model, '')), ''), model),
      ticket_id = COALESCE(NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''), ticket_id),
      committed_at = now(),
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  v_event_key := 'ai-reservation:' || v_row.id::text;

  INSERT INTO public.au_usage_events (
    user_id,
    feature,
    source,
    event_key,
    request_id,
    correlation_id,
    metric_increments,
    context,
    occurred_at
  )
  VALUES (
    v_row.user_id,
    v_row.feature_key,
    'vps-ai-gateway',
    v_event_key,
    NULLIF(TRIM(COALESCE(p_ticket_id, '')), ''),
    NULL,
    v_row.committed_units,
    jsonb_build_object(
      'reservation_id', v_row.id,
      'route', v_row.route,
      'provider', COALESCE(v_row.provider, ''),
      'model', COALESCE(v_row.model, ''),
      'admitted_at', v_row.created_at,
      'committed_at', v_row.committed_at
    ),
    v_row.created_at
  )
  ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.au_usage_events
    WHERE user_id = v_row.user_id
      AND event_key = v_event_key
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key,
    'status', v_row.status,
    'event_id', v_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
