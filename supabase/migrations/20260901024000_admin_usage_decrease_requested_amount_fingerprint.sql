-- Bind decrease retries to the caller's requested relative amount instead of the
-- state-dependent clamped delta. This keeps a completed no-op/clamped decrease
-- retry-safe after later usage accrues while preserving payload-bound idempotency.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_assert_usage_adjustment_replay(
  p_target_user_id UUID,
  p_metric_key TEXT,
  p_delta NUMERIC,
  p_action TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ,
  p_request_id TEXT,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.au_usage_admin_adjustments%ROWTYPE;
  v_metric_key TEXT := NULLIF(TRIM(COALESCE(p_metric_key, '')), '');
  v_action TEXT := LOWER(NULLIF(TRIM(COALESCE(p_action, '')), ''));
  v_request_id TEXT := NULLIF(TRIM(COALESCE(p_request_id, '')), '');
  v_requested_target TEXT := NULLIF(TRIM(COALESCE(p_context ->> 'requested_target', '')), '');
  v_existing_target TEXT;
  v_requested_amount NUMERIC;
  v_existing_requested_amount NUMERIC;
  v_existing_is_no_op BOOLEAN := FALSE;
BEGIN
  IF p_target_user_id IS NULL OR v_metric_key IS NULL OR p_delta IS NULL OR v_action IS NULL
     OR p_window_start IS NULL OR v_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment_replay' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'decrease' AND NULLIF(TRIM(COALESCE(p_context ->> 'requested_amount', '')), '') IS NOT NULL THEN
    BEGIN
      v_requested_amount := (p_context ->> 'requested_amount')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid_usage_adjustment_requested_amount' USING ERRCODE = '22023';
    END;

    IF v_requested_amount < 0
       OR v_requested_amount <> trunc(v_requested_amount)
       OR abs(v_requested_amount) > 9007199254740991::numeric THEN
      RAISE EXCEPTION 'invalid_usage_adjustment_requested_amount' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_existing
  FROM public.au_usage_admin_adjustments
  WHERE user_id = p_target_user_id
    AND metric_key = v_metric_key
    AND request_id = v_request_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_existing_target := NULLIF(TRIM(COALESCE(v_existing.context ->> 'requested_target', '')), '');
  v_existing_is_no_op := v_existing.delta = 0 AND COALESCE((v_existing.context ->> 'no_op')::boolean, FALSE);

  IF v_action = 'decrease'
     AND NULLIF(TRIM(COALESCE(v_existing.context ->> 'requested_amount', '')), '') IS NOT NULL THEN
    BEGIN
      v_existing_requested_amount := (v_existing.context ->> 'requested_amount')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'usage_adjustment_idempotency_conflict'
        USING ERRCODE = '22023',
              DETAIL = 'The stored usage adjustment has an invalid requested amount fingerprint.';
    END;
  END IF;

  IF v_existing.action <> v_action
     OR v_existing.window_start <> p_window_start
     OR NOT (v_existing.window_end IS NOT DISTINCT FROM p_window_end)
     OR (
       v_action = 'increase'
       AND v_existing.delta <> p_delta
     )
     OR (
       v_action = 'decrease'
       AND NOT (
         (v_existing_requested_amount IS NOT NULL
          AND v_requested_amount IS NOT NULL
          AND v_existing_requested_amount = v_requested_amount)
         OR
         -- Compatibility for zero-delta decrease receipts written by the immediately
         -- preceding branch revision before requested_amount was persisted. Such a
         -- receipt already proves the request completed without effect; never let a
         -- later retry acquire a new negative effect merely because the legacy row
         -- lacks the newly introduced fingerprint field.
         (v_existing_requested_amount IS NULL AND v_existing_is_no_op)
         OR
         -- Older non-no-op decrease rows predate requested_amount. Preserve their
         -- previous signed-delta fingerprint so already-deployed retries do not widen.
         (v_existing_requested_amount IS NULL
          AND NOT v_existing_is_no_op
          AND v_existing.delta = p_delta)
       )
     )
     OR (
       v_action IN ('set', 'reset')
       AND v_existing_target IS DISTINCT FROM v_requested_target
     ) THEN
    RAISE EXCEPTION 'usage_adjustment_idempotency_conflict'
      USING ERRCODE = '22023',
            DETAIL = 'The request ID was already used for a different usage adjustment payload.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assert_usage_adjustment_replay(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_assert_usage_adjustment_replay(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assert_usage_adjustment_replay(UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
