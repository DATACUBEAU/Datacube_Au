-- Compose the in-flight AI reservation guard with the legacy/hybrid usage checkpoint.
-- The prior reservation-guard wrapper accidentally replaced checkpointing; restoring
-- both behaviors keeps target corrections safe when canonical usage is still sourced
-- from mutable legacy rows.

BEGIN;

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
  v_version BIGINT := 0;
  v_checkpoint_delta NUMERIC := 0;
  v_result JSONB;
BEGIN
  IF p_target_user_id IS NULL OR p_expected_usage_version IS NULL OR p_expected_usage_version < 0 THEN
    RAISE EXCEPTION 'invalid_usage_version' USING ERRCODE = '22023';
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

  -- Target-derived corrections must not bake provisional AI reservations into a
  -- persistent delta. Relative increases remain independent of the current baseline.
  IF LOWER(TRIM(COALESCE(p_action, ''))) IN ('decrease', 'set', 'reset') THEN
    PERFORM public.assert_no_active_ai_usage_reservation(p_target_user_id, p_metric_key);
  END IF;

  -- Preserve the legacy/hybrid baseline before applying the correction. This must
  -- execute under the same mutation-version lock as the final adjustment.
  v_checkpoint_delta := public.admin_checkpoint_legacy_usage_gap(
    p_target_user_id,
    p_metric_key,
    p_window_start,
    p_window_end,
    p_expected_adjustment_total,
    p_request_id,
    p_context
  );

  v_result := public.admin_adjust_usage_checked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    p_metric_key,
    p_delta,
    p_action,
    p_window_start,
    p_window_end,
    p_reason,
    p_request_id,
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
  v_version BIGINT := 0;
  v_item JSONB;
  v_metric_key TEXT;
  v_action TEXT;
  v_checkpoint_delta NUMERIC := 0;
  v_checkpoint_total NUMERIC := 0;
  v_result JSONB;
BEGIN
  IF p_target_user_id IS NULL OR p_expected_usage_version IS NULL OR p_expected_usage_version < 0 THEN
    RAISE EXCEPTION 'invalid_usage_version' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'usage_adjustment_batch_required' USING ERRCODE = '22023';
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

  -- Validate the full batch before checkpoint work so every target-style correction
  -- observes the same in-flight reservation safety rule.
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

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
