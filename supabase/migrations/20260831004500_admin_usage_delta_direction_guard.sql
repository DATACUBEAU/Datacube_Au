-- Enforce relative admin usage adjustment direction at the authoritative SQL boundary.
--
-- The public versioned wrappers ultimately delegate to admin_adjust_usage_checked.
-- A direct caller could previously label a negative delta as `increase` (or a positive
-- delta as `decrease`). Besides corrupting immutable audit semantics, a mislabeled
-- negative increase bypassed the wrapper's in-flight AI reservation guard because
-- that guard intentionally blocks only decrease/set/reset target-reducing actions.
-- Keep the invariant in the shared checked implementation so single and batch
-- versioned paths, plus trusted internal callers, all receive the same validation.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_checked(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_metric_key TEXT,
  p_delta NUMERIC,
  p_action TEXT,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL,
  p_expected_adjustment_total NUMERIC DEFAULT 0,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_metric_key TEXT := NULLIF(TRIM(COALESCE(p_metric_key, '')), '');
  v_action TEXT := LOWER(NULLIF(TRIM(COALESCE(p_action, '')), ''));
  v_reason TEXT := NULLIF(TRIM(COALESCE(p_reason, '')), '');
  v_request_id TEXT := NULLIF(TRIM(COALESCE(p_request_id, '')), '');
  v_existing public.au_usage_admin_adjustments%ROWTYPE;
  v_inserted public.au_usage_admin_adjustments%ROWTYPE;
  v_definition public.au_usage_metric_definitions%ROWTYPE;
  v_total NUMERIC := 0;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'missing_actor_or_target' USING ERRCODE = '22023';
  END IF;

  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL OR v_requester <> p_actor_user_id OR NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'target_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_metric_key IS NULL OR p_delta IS NULL OR p_window_start IS NULL OR p_expected_adjustment_total IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment' USING ERRCODE = '22023';
  END IF;

  IF v_action NOT IN ('increase', 'decrease', 'set', 'reset') THEN
    RAISE EXCEPTION 'invalid_usage_adjustment_action' USING ERRCODE = '22023';
  END IF;

  -- Relative operations have one unambiguous signed meaning. Enforce it before
  -- any lock, replay lookup, checkpoint, or ledger mutation so action labels cannot
  -- be used to bypass higher-level safety composition.
  IF (v_action = 'increase' AND p_delta <= 0)
     OR (v_action = 'decrease' AND p_delta >= 0) THEN
    RAISE EXCEPTION 'invalid_usage_adjustment_direction' USING ERRCODE = '22023';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'usage_adjustment_reason_required' USING ERRCODE = '22023';
  END IF;

  IF v_request_id IS NULL OR length(v_request_id) < 8 OR length(v_request_id) > 200 THEN
    RAISE EXCEPTION 'usage_adjustment_request_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_definition
  FROM public.au_usage_metric_definitions
  WHERE metric_key = v_metric_key
    AND is_enabled = TRUE;

  IF NOT FOUND OR COALESCE(v_definition.limit_key, '') <> v_metric_key THEN
    RAISE EXCEPTION 'unsupported_usage_adjustment_metric:%', v_metric_key USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat_ws('|', p_target_user_id::TEXT, v_metric_key, p_window_start::TEXT, COALESCE(p_window_end::TEXT, '')),
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.au_usage_admin_adjustments
  WHERE user_id = p_target_user_id
    AND metric_key = v_metric_key
    AND request_id = v_request_id
  LIMIT 1;

  IF FOUND THEN
    SELECT COALESCE(SUM(delta), 0)
    INTO v_total
    FROM public.au_usage_admin_adjustments
    WHERE user_id = p_target_user_id
      AND metric_key = v_metric_key
      AND window_start = v_existing.window_start
      AND ((window_end IS NULL AND v_existing.window_end IS NULL) OR window_end = v_existing.window_end);

    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'adjustment_id', v_existing.id,
      'delta', v_existing.delta,
      'adjustment_total', COALESCE(v_total, 0),
      'created_at', v_existing.created_at
    );
  END IF;

  SELECT COALESCE(SUM(delta), 0)
  INTO v_total
  FROM public.au_usage_admin_adjustments
  WHERE user_id = p_target_user_id
    AND metric_key = v_metric_key
    AND window_start = p_window_start
    AND ((window_end IS NULL AND p_window_end IS NULL) OR window_end = p_window_end);

  IF COALESCE(v_total, 0) <> p_expected_adjustment_total THEN
    RAISE EXCEPTION 'usage_adjustment_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  -- Zero deltas remain valid only for target-style set/reset no-ops.
  IF p_delta = 0 THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', FALSE,
      'no_op', TRUE,
      'delta', 0,
      'adjustment_total', COALESCE(v_total, 0)
    );
  END IF;

  INSERT INTO public.au_usage_admin_adjustments (
    user_id,
    metric_key,
    delta,
    action,
    window_start,
    window_end,
    actor_user_id,
    actor_email,
    reason,
    request_id,
    context
  ) VALUES (
    p_target_user_id,
    v_metric_key,
    p_delta,
    v_action,
    p_window_start,
    p_window_end,
    p_actor_user_id,
    NULLIF(TRIM(COALESCE(p_actor_email, '')), ''),
    v_reason,
    v_request_id,
    COALESCE(p_context, '{}'::jsonb)
  )
  ON CONFLICT (user_id, metric_key, request_id) DO NOTHING
  RETURNING * INTO v_inserted;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM public.au_usage_admin_adjustments
    WHERE user_id = p_target_user_id
      AND metric_key = v_metric_key
      AND request_id = v_request_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'usage_adjustment_dedupe_lookup_failed' USING ERRCODE = '40001';
    END IF;
    v_inserted := v_existing;
  END IF;

  SELECT COALESCE(SUM(delta), 0)
  INTO v_total
  FROM public.au_usage_admin_adjustments
  WHERE user_id = p_target_user_id
    AND metric_key = v_metric_key
    AND window_start = p_window_start
    AND ((window_end IS NULL AND p_window_end IS NULL) OR window_end = p_window_end);

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', v_inserted.id <> COALESCE(v_existing.id, v_inserted.id),
    'adjustment_id', v_inserted.id,
    'delta', v_inserted.delta,
    'adjustment_total', COALESCE(v_total, 0),
    'created_at', v_inserted.created_at
  );
END;
$$;

-- This is an internal implementation RPC. The exposed versioned wrappers execute
-- it under their SECURITY DEFINER boundary; authenticated clients must not bypass
-- wrapper-level version, replay, reservation, and checkpoint safeguards.
REVOKE ALL ON FUNCTION public.admin_adjust_usage_checked(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_usage_checked(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_checked(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
