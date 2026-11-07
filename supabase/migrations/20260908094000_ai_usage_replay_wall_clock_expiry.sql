-- Recheck idempotent AI reservation replay expiry using wall-clock time after
-- the canonical per-user accounting lock has been acquired.
--
-- PostgreSQL now() is transaction-stable. A replay can start just before its
-- settlement lease expires, wait on usage_accounting_user serialization, then
-- enter the older replay implementation after real expiry while now() still
-- reports the pre-expiry timestamp. Expire that replay at this serialized
-- boundary so the ticket route never receives a usable-looking ticket for a
-- reservation that begin_ai_usage_reservation will immediately reject.

BEGIN;

ALTER FUNCTION public.reserve_ai_usage_user_serialized_unchecked(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) RENAME TO reserve_ai_usage_replay_wall_clock_unchecked;

REVOKE ALL ON FUNCTION public.reserve_ai_usage_replay_wall_clock_unchecked(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_ai_usage_user_serialized_unchecked(
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
  v_wall_clock TIMESTAMPTZ;
  v_effective_expiry TIMESTAMPTZ;
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'USAGE_USER_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- The public reserve_ai_usage wrapper already holds usage_accounting_user for
  -- this user before delegating here. Re-read and lock the existing reservation
  -- only after that serialization boundary; no replay decision is based on an
  -- unlocked probe or transaction-start time.
  SELECT *
  INTO v_existing
  FROM public.ai_usage_reservations
  WHERE user_id = p_user_id
    AND feature_key = p_feature_key
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'reserved' THEN
    v_wall_clock := clock_timestamp();
    v_effective_expiry := public.ai_usage_reservation_effective_expiry(
      v_existing.expires_at,
      v_existing.provider_started_at
    );

    IF v_effective_expiry <= v_wall_clock THEN
      -- This mirrors the historical replay-expiry transition, but evaluates the
      -- lease only after user serialization with real wall-clock time. The
      -- reservation is terminalized atomically with its reserved counter refund.
      PERFORM public.increment_usage_counters(
        v_existing.user_id,
        public.ai_usage_negate_units(v_existing.reserved_units),
        v_existing.usage_day
      );

      UPDATE public.ai_usage_reservations
      SET status = 'expired',
          released_at = v_wall_clock,
          failure_code = COALESCE(failure_code, 'expired_reservation'),
          updated_at = v_wall_clock
      WHERE id = v_existing.id
        AND status = 'reserved';

      RETURN jsonb_build_object(
        'ok', FALSE,
        'deduped', TRUE,
        'reservation_id', v_existing.id,
        'idempotency_key', v_existing.idempotency_key,
        'status', 'expired',
        'code', 'USAGE_RESERVATION_NOT_ACTIVE'
      );
    END IF;
  END IF;

  RETURN public.reserve_ai_usage_replay_wall_clock_unchecked(
    p_user_id,
    p_feature_key,
    p_route,
    p_idempotency_key,
    p_request_fingerprint,
    p_metric_increments,
    p_limit_checks,
    p_estimated_units,
    p_ticket_id,
    p_expires_at
  );
END;
$$;

-- This remains an internal implementation. The public reserve_ai_usage entry
-- point is service-role-only and owns the canonical per-user advisory lock.
REVOKE ALL ON FUNCTION public.reserve_ai_usage_user_serialized_unchecked(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
