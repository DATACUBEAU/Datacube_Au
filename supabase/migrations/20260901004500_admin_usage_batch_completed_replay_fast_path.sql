-- Return an entirely completed admin usage batch before guards for new work.
--
-- reset_all is transactional. If its response is lost, later metered usage may
-- advance the user's mutation version or create active AI reservations before
-- the exact HTTP request is retried. Those guards protect new corrections; they
-- must not turn recovery of an already-committed batch into a conflict.
--
-- Acquire every exact quota-window advisory lock first, validate every immutable
-- replay fingerprint, then return through the checked batch dedupe path only when
-- every submitted request identity already exists. Partial/new batches retain the
-- existing mutation-version, reservation, checkpoint, and checked-write path.

BEGIN;

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

  -- Serialize every item against concurrent first inserts. Sorting the bigint
  -- identities gives all batches the same advisory-lock acquisition order.
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

  -- Fingerprint validation must precede completed-batch detection. A reused
  -- request ID with a different action/target/window is never a valid replay.
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
    -- The checked batch writer returns authoritative persisted rows for matching
    -- request IDs. The advisory locks above are re-entrant in this transaction.
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

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(UUID, TEXT, UUID, TEXT, BIGINT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
