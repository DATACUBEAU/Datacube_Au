-- Reject reuse of an admin-usage idempotency key for a different logical mutation.
--
-- request_id is a retry key, not permission to reinterpret an earlier write. The API
-- stores a deterministic logical-request fingerprint in adjustment context; versioned
-- single and batch RPCs validate any existing row before checkpointing or deduping.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_assert_usage_adjustment_replay(
  p_target_user_id UUID,
  p_metric_key TEXT,
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
  v_fingerprint TEXT := NULLIF(TRIM(COALESCE(p_context ->> 'request_fingerprint', '')), '');
  v_existing_fingerprint TEXT;
BEGIN
  IF p_target_user_id IS NULL OR v_metric_key IS NULL OR v_action IS NULL
     OR p_window_start IS NULL OR v_request_id IS NULL OR v_fingerprint IS NULL THEN
    RAISE EXCEPTION 'usage_adjustment_request_fingerprint_required' USING ERRCODE = '22023';
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

  v_existing_fingerprint := NULLIF(TRIM(COALESCE(v_existing.context ->> 'request_fingerprint', '')), '');

  IF v_existing.action <> v_action
     OR v_existing.window_start <> p_window_start
     OR NOT (v_existing.window_end IS NOT DISTINCT FROM p_window_end)
     OR v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
    RAISE EXCEPTION 'usage_adjustment_idempotency_conflict'
      USING ERRCODE = '22023',
            DETAIL = 'The request ID was already used for a different usage adjustment payload.';
  END IF;
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

  SELECT version INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_version, 0) <> p_expected_usage_version THEN
    RAISE EXCEPTION 'usage_mutation_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Metered usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  PERFORM public.admin_assert_usage_adjustment_replay(
    p_target_user_id,
    p_metric_key,
    p_action,
    p_window_start,
    p_window_end,
    p_request_id,
    p_context
  );

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

  SELECT version INTO v_version
  FROM public.au_usage_mutation_versions
  WHERE user_id = p_target_user_id
  FOR UPDATE;

  IF COALESCE(v_version, 0) <> p_expected_usage_version THEN
    RAISE EXCEPTION 'usage_mutation_conflict'
      USING ERRCODE = '40001',
            DETAIL = 'Metered usage changed after it was loaded. Refresh and retry the operation.';
  END IF;

  -- Validate every scoped retry key before creating any checkpoint event so a batch
  -- with one mismatched replay fails atomically and leaves no partial accounting work.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    PERFORM public.admin_assert_usage_adjustment_replay(
      p_target_user_id,
      v_item ->> 'metricKey',
      v_item ->> 'action',
      (v_item ->> 'windowStart')::timestamptz,
      NULLIF(v_item ->> 'windowEnd', '')::timestamptz,
      v_item ->> 'requestId',
      COALESCE(v_item -> 'context', '{}'::jsonb)
    );
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

REVOKE ALL ON FUNCTION public.admin_assert_usage_adjustment_replay(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assert_usage_adjustment_replay(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
