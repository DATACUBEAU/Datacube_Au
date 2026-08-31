-- Return an already-completed admin usage mutation before guards for new work.
--
-- A matching idempotent replay is recovery of a committed operation, not a new
-- correction. If fresh AI work starts after the original commit, reservation or
-- mutation-version guards must not turn that completed replay into a conflict.
-- Validate the immutable replay fingerprint under the existing quota-window
-- advisory lock, then return the persisted result before touching live-mutation
-- guards. New requests retain the existing version/reservation/checkpoint path.

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
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
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

  IF NULLIF(TRIM(COALESCE(p_metric_key, '')), '') IS NULL OR p_window_start IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment' USING ERRCODE = '22023';
  END IF;

  -- Serialize the request key against a concurrent first insert using the same
  -- exact quota-window lock used by the checked writer and AI admission.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(
        '|',
        p_target_user_id::TEXT,
        TRIM(p_metric_key),
        p_window_start::TEXT,
        COALESCE(p_window_end::TEXT, '')
      ),
      0
    )
  );

  -- Fingerprint validation must precede the replay fast-path so a reused request
  -- ID with a different action/target/window is still rejected, never deduped.
  PERFORM public.admin_assert_usage_adjustment_replay(
    p_target_user_id,
    p_metric_key,
    p_delta,
    p_action,
    p_window_start,
    p_window_end,
    p_request_id,
    p_context
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.au_usage_admin_adjustments
    WHERE user_id = p_target_user_id
      AND metric_key = TRIM(p_metric_key)
      AND request_id = NULLIF(TRIM(COALESCE(p_request_id, '')), '')
  ) INTO v_completed;

  IF v_completed THEN
    -- The lower-level checked function returns the authoritative persisted row
    -- and aggregate total for an existing request before its conflict check.
    -- The advisory lock above is re-entrant for this transaction.
    RETURN public.admin_adjust_usage_checked(
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
    PERFORM public.assert_no_active_ai_usage_reservation(p_target_user_id, p_metric_key);
  END IF;

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

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
