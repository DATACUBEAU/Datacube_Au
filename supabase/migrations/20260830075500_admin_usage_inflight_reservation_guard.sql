-- Prevent target-style admin usage corrections from baking provisional AI reservations
-- into persistent signed adjustments. A reserved AI request may still release/expire,
-- which would otherwise leave set/decrease/reset corrections permanently offset.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_no_active_ai_usage_reservation(
  p_user_id UUID,
  p_metric_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_active BOOLEAN := FALSE;
BEGIN
  IF p_user_id IS NULL OR NULLIF(TRIM(COALESCE(p_metric_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_reservation_guard' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.ai_usage_reservations AS r
    WHERE r.user_id = p_user_id
      AND r.status = 'reserved'
      AND r.expires_at > now()
      AND public.ai_usage_jsonb_numeric_value(
        COALESCE(r.reserved_units, '{}'::jsonb),
        p_metric_key
      ) > 0
  )
  INTO v_has_active;

  IF v_has_active THEN
    RAISE EXCEPTION 'usage_reservation_in_flight'
      USING ERRCODE = '40001',
            DETAIL = 'AI usage is still in flight for this usage item. Wait for it to finish, then refresh and retry.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_no_active_ai_usage_reservation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_no_active_ai_usage_reservation(UUID, TEXT) FROM anon, authenticated, service_role;

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

  -- Relative increases remain valid independent of provisional usage. Decrease/set/reset
  -- are target-derived and must not persist while the target includes work that can release.
  IF LOWER(TRIM(COALESCE(p_action, ''))) IN ('decrease', 'set', 'reset') THEN
    PERFORM public.assert_no_active_ai_usage_reservation(p_target_user_id, p_metric_key);
  END IF;

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
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, NUMERIC, BIGINT, JSONB) TO service_role;

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

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_metric_key := NULLIF(TRIM(COALESCE(v_item->>'metricKey', '')), '');
    v_action := LOWER(TRIM(COALESCE(v_item->>'action', '')));

    IF v_action IN ('decrease', 'set', 'reset') THEN
      PERFORM public.assert_no_active_ai_usage_reservation(p_target_user_id, v_metric_key);
    END IF;
  END LOOP;

  RETURN public.admin_adjust_usage_batch_checked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    p_reason,
    p_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
