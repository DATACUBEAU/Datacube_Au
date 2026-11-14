-- Prevent relative usage increases from checkpointing a legacy baseline against
-- provisional AI reservation units that may later be released.
--
-- Target-derived decreases/set/reset operations are already blocked while a
-- matching reservation remains in `reserved` state. Relative increases do not
-- depend on current usage for their signed delta, but they still pass through
-- admin_checkpoint_legacy_usage_gap(...). For daily/lifetime metrics that helper
-- reads usage_counters/usage_totals, which already include reserved units. If a
-- checkpoint materializes only the legacy-over-tracked gap while those units are
-- provisional, a later reservation release can leave the durable canonical
-- baseline understated.
--
-- Keep completed replay recovery ahead of this guard: an already-persisted
-- increase remains idempotently replayable even if new AI work starts later.
-- Only new mutations that could checkpoint are blocked until the reservation
-- settles. This reuses the existing authoritative reservation guard and does not
-- introduce another usage counter or reconciliation model.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_versioned_user_serialized_unchecked(
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

  -- Serialize immutable request identity before the narrower quota-window lock.
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

  -- Completed operations are recovery, not new checkpoint work. Preserve exact
  -- replay semantics before checking the current reservation state.
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

  -- Any new adjustment can materialize a mutable legacy/hybrid checkpoint. For
  -- increases, the signed delta itself is independent of current usage, but the
  -- checkpoint is not: daily/lifetime tracked counters already include reserved
  -- AI units. Wait until those units become terminal so the checkpoint baseline
  -- cannot be understated by a later release. Existing target-derived actions
  -- retain the same reservation safety through this unified guard.
  IF LOWER(TRIM(COALESCE(p_action, ''))) IN ('increase', 'decrease', 'set', 'reset') THEN
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

-- This is an internal implementation reached only through the public per-user
-- serialization wrapper. Keep it unreachable from every PostgREST role.
REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned_user_serialized_unchecked(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the final trusted-server public mutation boundary.
REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
