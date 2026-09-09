-- Make admin usage adjustment retries concurrency-safe.
--
-- The original RPC checks for an existing request before insert. Two concurrent
-- requests can both pass that check and race on the unique constraint. This
-- replacement keeps the fast-path lookup, but also treats a conflicting insert
-- as a successful deduplicated retry after the winning transaction commits.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage(
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

  IF v_metric_key IS NULL OR p_delta IS NULL OR p_delta = 0 OR p_window_start IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment' USING ERRCODE = '22023';
  END IF;

  IF v_action NOT IN ('increase', 'decrease', 'set', 'reset') THEN
    RAISE EXCEPTION 'invalid_usage_adjustment_action' USING ERRCODE = '22023';
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

  SELECT * INTO v_existing
  FROM public.au_usage_admin_adjustments
  WHERE user_id = p_target_user_id
    AND metric_key = v_metric_key
    AND request_id = v_request_id
  LIMIT 1;

  IF FOUND THEN
    SELECT public.get_usage_admin_adjustment_total(
      p_target_user_id,
      v_metric_key,
      v_existing.window_start,
      v_existing.window_end
    ) INTO v_total;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'adjustment_id', v_existing.id,
      'delta', v_existing.delta,
      'adjustment_total', COALESCE(v_total, 0),
      'created_at', v_existing.created_at
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
    -- A concurrent retry won the unique-key race. READ COMMITTED gives this new
    -- statement a fresh snapshot after the conflicting transaction completes.
    SELECT * INTO v_existing
    FROM public.au_usage_admin_adjustments
    WHERE user_id = p_target_user_id
      AND metric_key = v_metric_key
      AND request_id = v_request_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'usage_adjustment_dedupe_lookup_failed' USING ERRCODE = '40001';
    END IF;

    SELECT public.get_usage_admin_adjustment_total(
      p_target_user_id,
      v_metric_key,
      v_existing.window_start,
      v_existing.window_end
    ) INTO v_total;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'deduped', TRUE,
      'adjustment_id', v_existing.id,
      'delta', v_existing.delta,
      'adjustment_total', COALESCE(v_total, 0),
      'created_at', v_existing.created_at
    );
  END IF;

  SELECT public.get_usage_admin_adjustment_total(
    p_target_user_id,
    v_metric_key,
    p_window_start,
    p_window_end
  ) INTO v_total;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'deduped', FALSE,
    'adjustment_id', v_inserted.id,
    'delta', v_inserted.delta,
    'adjustment_total', COALESCE(v_total, 0),
    'created_at', v_inserted.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage(UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
