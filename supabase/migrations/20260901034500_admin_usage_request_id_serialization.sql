-- Serialize the immutable admin-usage idempotency identity independently of the
-- quota window. The ledger uniqueness key is (user_id, metric_key, request_id),
-- so window-only advisory locks allow two concurrent requests using the same key
-- in different windows to pass replay preflight before either row exists.
--
-- Always acquire request-key locks before quota-window locks. The checked writer
-- enforces the same order so public wrappers and service-role callers share one
-- authoritative serialization boundary.

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

  IF (v_action = 'increase' AND p_delta <= 0)
     OR (v_action = 'decrease' AND p_delta > 0)
     OR (p_delta = 0 AND v_action NOT IN ('decrease', 'set', 'reset')) THEN
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

  -- The immutable request identity is broader than a quota window. Acquire this
  -- first everywhere so a reused request ID cannot race through different windows.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat_ws('|', 'admin_usage_request', p_target_user_id::TEXT, v_metric_key, v_request_id),
      0
    )
  );

  -- Preserve the existing window serialization after the request-key boundary.
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
    -- Revalidate immutable payload after serialization. This also protects direct
    -- service-role callers of the checked writer, not only the public wrapper.
    PERFORM public.admin_assert_usage_adjustment_replay(
      p_target_user_id,
      v_metric_key,
      p_delta,
      v_action,
      p_window_start,
      p_window_end,
      v_request_id,
      p_context
    );

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
      'no_op', v_existing.delta = 0,
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
    COALESCE(p_context, '{}'::jsonb) || CASE
      WHEN p_delta = 0 THEN jsonb_build_object('no_op', TRUE)
      ELSE '{}'::jsonb
    END
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

    -- Defensive fingerprint check in case a caller predating this migration did
    -- not acquire the request-key lock before racing this insert.
    PERFORM public.admin_assert_usage_adjustment_replay(
      p_target_user_id,
      v_metric_key,
      p_delta,
      v_action,
      p_window_start,
      p_window_end,
      v_request_id,
      p_context
    );
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
    'no_op', v_inserted.delta = 0,
    'adjustment_id', v_inserted.id,
    'delta', v_inserted.delta,
    'adjustment_total', COALESCE(v_total, 0),
    'created_at', v_inserted.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_versioned(
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
  p_expected_usage_version BIGINT DEFAULT 0,
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
  v_request_id TEXT := NULLIF(TRIM(COALESCE(p_request_id, '')), '');
  v_version BIGINT := 0;
  v_checkpoint_delta NUMERIC := 0;
  v_result JSONB;
  v_completed BOOLEAN := FALSE;
BEGIN
  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL OR v_requester <> p_actor_user_id OR NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_target_user_id IS NULL OR p_expected_usage_version IS NULL OR p_expected_usage_version < 0 THEN
    RAISE EXCEPTION 'invalid_usage_version' USING ERRCODE = '22023';
  END IF;

  IF v_metric_key IS NULL OR p_window_start IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment' USING ERRCODE = '22023';
  END IF;

  IF v_request_id IS NULL OR length(v_request_id) < 8 OR length(v_request_id) > 200 THEN
    RAISE EXCEPTION 'usage_adjustment_request_id_required' USING ERRCODE = '22023';
  END IF;

  -- Lock immutable request identity before the narrower quota-window lock.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat_ws('|', 'admin_usage_request', p_target_user_id::TEXT, v_metric_key, v_request_id),
      0
    )
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat_ws('|', p_target_user_id::TEXT, v_metric_key, p_window_start::TEXT, COALESCE(p_window_end::TEXT, '')),
      0
    )
  );

  PERFORM public.admin_assert_usage_adjustment_replay(
    p_target_user_id,
    v_metric_key,
    p_delta,
    p_action,
    p_window_start,
    p_window_end,
    v_request_id,
    p_context
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.au_usage_admin_adjustments
    WHERE user_id = p_target_user_id
      AND metric_key = v_metric_key
      AND request_id = v_request_id
  ) INTO v_completed;

  IF v_completed THEN
    RETURN public.admin_adjust_usage_checked(
      p_actor_user_id,
      p_actor_email,
      p_target_user_id,
      v_metric_key,
      p_delta,
      p_action,
      p_window_start,
      p_window_end,
      p_reason,
      v_request_id,
      p_expected_adjustment_total,
      p_context
    ) || jsonb_build_object('checkpoint_delta', 0);
  END IF;

  INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
  VALUES (p_target_user_id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT version
  INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_version, 0) <> p_expected_usage_version THEN
    RAISE EXCEPTION 'usage_mutation_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Metered usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  IF LOWER(TRIM(COALESCE(p_action, ''))) IN ('decrease', 'set', 'reset') THEN
    PERFORM public.assert_no_active_ai_usage_reservation(p_target_user_id, v_metric_key);
  END IF;

  v_checkpoint_delta := public.admin_checkpoint_legacy_usage_gap(
    p_target_user_id,
    v_metric_key,
    p_window_start,
    p_window_end,
    p_expected_adjustment_total,
    v_request_id,
    p_context
  );

  v_result := public.admin_adjust_usage_checked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    v_metric_key,
    p_delta,
    p_action,
    p_window_start,
    p_window_end,
    p_reason,
    v_request_id,
    p_expected_adjustment_total,
    p_context
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'checkpoint_delta', v_checkpoint_delta
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_batch_versioned(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_reason TEXT,
  p_expected_usage_version BIGINT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_version BIGINT := 0;
  v_item JSONB;
  v_metric_key TEXT;
  v_action TEXT;
  v_lock_key BIGINT;
  v_checkpoint_delta NUMERIC := 0;
  v_checkpoint_total NUMERIC := 0;
  v_result JSONB;
  v_completed BOOLEAN := FALSE;
BEGIN
  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL OR v_requester <> p_actor_user_id OR NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_target_user_id IS NULL OR p_expected_usage_version IS NULL OR p_expected_usage_version < 0 THEN
    RAISE EXCEPTION 'invalid_usage_version' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'usage_adjustment_batch_required' USING ERRCODE = '22023';
  END IF;

  -- All batch request identities are acquired first, in deterministic hash order.
  -- This matches the single-item wrapper and prevents cross-window/cross-batch races.
  FOR v_lock_key IN
    SELECT DISTINCT hashtextextended(
      concat_ws(
        '|',
        'admin_usage_request',
        p_target_user_id::TEXT,
        TRIM(value ->> 'metricKey'),
        TRIM(value ->> 'requestId')
      ),
      0
    ) AS lock_key
    FROM jsonb_array_elements(p_items)
    WHERE NULLIF(TRIM(COALESCE(value ->> 'metricKey', '')), '') IS NOT NULL
      AND NULLIF(TRIM(COALESCE(value ->> 'requestId', '')), '') IS NOT NULL
    ORDER BY lock_key
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock_key);
  END LOOP;

  -- Quota-window locks are always second and remain deterministic across batches.
  FOR v_lock_key IN
    SELECT DISTINCT hashtextextended(
      concat_ws(
        '|',
        p_target_user_id::TEXT,
        TRIM(value ->> 'metricKey'),
        ((value ->> 'windowStart')::timestamptz)::TEXT,
        COALESCE((NULLIF(value ->> 'windowEnd', '')::timestamptz)::TEXT, '')
      ),
      0
    ) AS lock_key
    FROM jsonb_array_elements(p_items)
    ORDER BY lock_key
  LOOP
    PERFORM pg_advisory_xact_lock(v_lock_key);
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    PERFORM public.admin_assert_usage_adjustment_replay(
      p_target_user_id,
      v_item ->> 'metricKey',
      (v_item ->> 'delta')::numeric,
      v_item ->> 'action',
      (v_item ->> 'windowStart')::timestamptz,
      NULLIF(v_item ->> 'windowEnd', '')::timestamptz,
      v_item ->> 'requestId',
      COALESCE(v_item -> 'context', '{}'::jsonb)
    );
  END LOOP;

  SELECT COALESCE(
    bool_and(
      NULLIF(TRIM(COALESCE(value ->> 'requestId', '')), '') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.au_usage_admin_adjustments a
        WHERE a.user_id = p_target_user_id
          AND a.metric_key = TRIM(value ->> 'metricKey')
          AND a.request_id = NULLIF(TRIM(COALESCE(value ->> 'requestId', '')), '')
      )
    ),
    FALSE
  )
  INTO v_completed
  FROM jsonb_array_elements(p_items);

  IF v_completed THEN
    RETURN public.admin_adjust_usage_batch_checked(
      p_actor_user_id,
      p_actor_email,
      p_target_user_id,
      p_reason,
      p_items
    ) || jsonb_build_object('checkpoint_total', 0);
  END IF;

  INSERT INTO public.au_usage_mutation_versions (user_id, version, updated_at)
  VALUES (p_target_user_id, 0, now())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT version
  INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_version, 0) <> p_expected_usage_version THEN
    RAISE EXCEPTION 'usage_mutation_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Metered usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_metric_key := NULLIF(TRIM(COALESCE(v_item->>'metricKey', '')), '');
    v_action := LOWER(TRIM(COALESCE(v_item->>'action', '')));

    IF v_action IN ('decrease', 'set', 'reset') THEN
      PERFORM public.assert_no_active_ai_usage_reservation(p_target_user_id, v_metric_key);
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_checkpoint_delta := public.admin_checkpoint_legacy_usage_gap(
      p_target_user_id,
      v_item ->> 'metricKey',
      (v_item ->> 'windowStart')::timestamptz,
      NULLIF(v_item ->> 'windowEnd', '')::timestamptz,
      COALESCE((v_item ->> 'expectedAdjustmentTotal')::numeric, 0),
      v_item ->> 'requestId',
      COALESCE(v_item -> 'context', '{}'::jsonb)
    );
    v_checkpoint_total := v_checkpoint_total + COALESCE(v_checkpoint_delta, 0);
  END LOOP;

  v_result := public.admin_adjust_usage_batch_checked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    p_reason,
    p_items
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'checkpoint_total', v_checkpoint_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_checked(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_usage_checked(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_checked(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
