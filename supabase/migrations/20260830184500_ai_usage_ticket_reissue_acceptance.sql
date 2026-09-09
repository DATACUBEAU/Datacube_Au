-- Do not let reservation replay replace the active provider-attempt identity.
--
-- reserve_ai_usage historically refreshed ticket_id (and the reservation expiry)
-- as soon as an idempotent reservation replay arrived. A replacement ticket can
-- then be rejected by begin_ai_usage_reservation's in-progress guard while the
-- older provider attempt is still running, leaving that older attempt unable to
-- commit or release because terminal settlement is bound to the newer ticket.
--
-- Serialize replay inspection on the same daily -> lifetime accounting rows used
-- by the reservation lifecycle. Existing reservations keep their current ticket
-- and expiry here; begin_ai_usage_reservation remains the sole place that accepts
-- a takeover/retry, binds its ticket, and grants its fresh settlement lease.

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
  v_check JSONB;
  v_scope TEXT;
  v_counter_scope TEXT;
  v_metric_key TEXT;
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_usage_day DATE := (now() AT TIME ZONE 'UTC')::date;
  v_locked_today JSONB;
  v_locked_total JSONB;
  v_existing public.ai_usage_reservations%ROWTYPE;
  v_forward_ticket_id TEXT := p_ticket_id;
  v_forward_expires_at TIMESTAMPTZ := p_expires_at;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF p_limit_checks IS NOT NULL AND jsonb_typeof(p_limit_checks) = 'array' THEN
    FOR v_check IN SELECT value FROM jsonb_array_elements(p_limit_checks)
    LOOP
      v_scope := LOWER(NULLIF(TRIM(COALESCE(v_check ->> 'scope', '')), ''));
      v_counter_scope := LOWER(NULLIF(TRIM(COALESCE(v_check ->> 'counter_scope', '')), ''));

      IF v_scope = 'canonical_plan'
         AND v_counter_scope IN ('today', 'window')
         AND NULLIF(TRIM(COALESCE(v_check ->> 'window_start', '')), '') IS NOT NULL
         AND NULLIF(TRIM(COALESCE(v_check ->> 'window_end', '')), '') IS NOT NULL THEN
        v_window_start := (v_check ->> 'window_start')::TIMESTAMPTZ;
        v_window_end := (v_check ->> 'window_end')::TIMESTAMPTZ;

        IF v_window_end <= v_window_start OR v_now < v_window_start OR v_now >= v_window_end THEN
          v_metric_key := NULLIF(TRIM(COALESCE(v_check ->> 'metric_key', '')), '');
          RETURN jsonb_build_object(
            'ok', FALSE,
            'code', 'USAGE_WINDOW_STALE',
            'metric_key', v_metric_key,
            'status', 'rejected',
            'window_start', v_window_start,
            'window_end', v_window_end,
            'retryable', TRUE
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Use the lifecycle lock order before deciding whether this is a replay. This
  -- prevents two reserve calls (or reserve vs terminal settlement) from making
  -- the ticket-forwarding decision from an unsynchronized reservation snapshot.
  INSERT INTO public.usage_counters (user_id, day, counters)
  VALUES (p_user_id, v_usage_day, '{}'::jsonb)
  ON CONFLICT (user_id, day) DO NOTHING;

  INSERT INTO public.usage_totals (user_id, counters)
  VALUES (p_user_id, '{}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT counters INTO v_locked_today
  FROM public.usage_counters
  WHERE user_id = p_user_id AND day = v_usage_day
  FOR UPDATE;

  SELECT counters INTO v_locked_total
  FROM public.usage_totals
  WHERE user_id = p_user_id
  FOR UPDATE;

  SELECT * INTO v_existing
  FROM public.ai_usage_reservations
  WHERE user_id = p_user_id
    AND feature_key = p_feature_key
    AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- Reservation replay must not claim a provider attempt before that attempt is
    -- accepted. Preserve both current attempt identity and current lease. The
    -- begin function owns ticket replacement + lease refresh after its guard.
    v_forward_ticket_id := NULL;
    v_forward_expires_at := v_existing.expires_at;
  END IF;

  RETURN public.reserve_ai_usage_window_unchecked(
    p_user_id,
    p_feature_key,
    p_route,
    p_idempotency_key,
    p_request_fingerprint,
    p_metric_increments,
    p_limit_checks,
    p_estimated_units,
    v_forward_ticket_id,
    v_forward_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_usage(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
