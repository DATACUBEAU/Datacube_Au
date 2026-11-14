-- Prevent a provider completion from committing after its bounded settlement lease has expired.
-- Finite-window admission stops counting expired reservations, so accepting a late commit would
-- allow newly admitted work plus the late usage event to exceed the authoritative quota.
-- Keep committed retries idempotent, but require an active reserved row to still be inside the
-- same effective lease used by reservation cleanup.

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
  v_effective_expiry TIMESTAMPTZ;
  v_ticket_id TEXT := NULLIF(TRIM(COALESCE(p_ticket_id, '')), '');
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

  -- ticket_id is bound only when begin_ai_usage_reservation accepts a provider attempt.
  -- Once a takeover replaces it, an older attempt must not be able to commit or receive
  -- a deduped success for the newer attempt's reservation. Legacy rows without a bound
  -- ticket retain rolling-deploy compatibility.
  IF v_row.ticket_id IS NOT NULL
    AND (v_ticket_id IS NULL OR v_ticket_id IS DISTINCT FROM v_row.ticket_id) THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'code', 'USAGE_RESERVATION_ATTEMPT_MISMATCH',
      'reservation_id', v_row.id,
      'idempotency_key', v_row.idempotency_key,
      'status', v_row.status
    );
  END IF;

  -- A completed reservation remains safely replayable after its lease because its durable
  -- usage event already participates in quota accounting. Lease validity is required only
  -- for the still-provisional reserved -> committed transition.
  IF v_row.status = 'committed' THEN
    v_event_key := 'ai-reservation:' || v_row.id::text;
    SELECT id INTO v_event_id
    FROM public.au_usage_events
    WHERE user_id = v_row.user_id AND event_key = v_event_key
    LIMIT 1;

    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'committed reservation is missing its usage event'
        USING ERRCODE = '23514';
    END IF;

    PERFORM public.assert_ai_reservation_usage_event(
      v_event_id, v_row.user_id, v_row.id, v_row.feature_key,
      v_row.committed_units, v_row.created_at
    );

    RETURN jsonb_build_object('ok', TRUE, 'deduped', TRUE, 'reservation_id', v_row.id,
      'idempotency_key', v_row.idempotency_key, 'status', v_row.status, 'event_id', v_event_id);
  END IF;

  IF v_row.status = 'reserved' THEN
    v_effective_expiry := public.ai_usage_reservation_effective_expiry(
      v_row.expires_at,
      v_row.provider_started_at
    );

    IF v_effective_expiry <= now() THEN
      RETURN jsonb_build_object(
        'ok', FALSE,
        'code', 'USAGE_RESERVATION_EXPIRED',
        'reservation_id', v_row.id,
        'idempotency_key', v_row.idempotency_key,
        'status', v_row.status,
        'effective_expires_at', v_effective_expiry
      );
    END IF;
  END IF;

  IF v_row.status <> 'reserved' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'USAGE_RESERVATION_NOT_ACTIVE', 'status', v_row.status);
  END IF;

  UPDATE public.ai_usage_reservations
  SET status = 'committed',
      committed_units = reserved_units,
      provider = COALESCE(NULLIF(TRIM(COALESCE(p_provider, '')), ''), provider),
      model = COALESCE(NULLIF(TRIM(COALESCE(p_model, '')), ''), model),
      committed_at = now(), updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  v_event_key := 'ai-reservation:' || v_row.id::text;

  INSERT INTO public.au_usage_events (
    user_id, feature, source, event_key, request_id, correlation_id,
    metric_increments, context, occurred_at
  ) VALUES (
    v_row.user_id, v_row.feature_key, 'vps-ai-gateway', v_event_key,
    v_ticket_id, NULL, v_row.committed_units,
    jsonb_build_object('reservation_id', v_row.id, 'route', v_row.route,
      'provider', COALESCE(v_row.provider, ''), 'model', COALESCE(v_row.model, ''),
      'admitted_at', v_row.created_at, 'committed_at', v_row.committed_at),
    v_row.created_at
  )
  ON CONFLICT (user_id, event_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT id INTO v_event_id
    FROM public.au_usage_events
    WHERE user_id = v_row.user_id AND event_key = v_event_key
    LIMIT 1;

    IF v_event_id IS NULL THEN
      RAISE EXCEPTION 'AI reservation usage-event conflict could not be resolved'
        USING ERRCODE = '23505';
    END IF;

    PERFORM public.assert_ai_reservation_usage_event(
      v_event_id, v_row.user_id, v_row.id, v_row.feature_key,
      v_row.committed_units, v_row.created_at
    );
  END IF;

  RETURN jsonb_build_object('ok', TRUE, 'deduped', FALSE, 'reservation_id', v_row.id,
    'idempotency_key', v_row.idempotency_key, 'status', v_row.status, 'event_id', v_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.commit_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ai_usage(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
