-- Reject stale finite quota windows at the authoritative AI reservation boundary.
--
-- App instances compute canonical reset windows before calling reserve_ai_usage.
-- A request delayed across a reset boundary must not be admitted against the
-- previous window. Older rolling-deploy callers that do not send window metadata
-- retain the existing compatibility path.

BEGIN;

ALTER FUNCTION public.reserve_ai_usage(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) RENAME TO reserve_ai_usage_window_unchecked;

REVOKE ALL ON FUNCTION public.reserve_ai_usage_window_unchecked(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_ai_usage(
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
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF p_limit_checks IS NOT NULL AND jsonb_typeof(p_limit_checks) = 'array' THEN
    FOR v_check IN SELECT value FROM jsonb_array_elements(p_limit_checks)
    LOOP
      v_scope := LOWER(NULLIF(TRIM(COALESCE(v_check ->> 'scope', '')), ''));
      v_counter_scope := LOWER(NULLIF(TRIM(COALESCE(v_check ->> 'counter_scope', '')), ''));

      -- Tier quotas do not carry canonical plan reset-window metadata. Lifetime
      -- canonical checks also have no finite end boundary. Validate only finite
      -- canonical windows while preserving old payloads that omit these fields.
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

  RETURN public.reserve_ai_usage_window_unchecked(
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

REVOKE ALL ON FUNCTION public.reserve_ai_usage(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) TO service_role;

COMMIT;
