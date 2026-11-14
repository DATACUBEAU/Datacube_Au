-- Prevent a single admin usage batch from reusing one idempotency key for the
-- same metric. The lower-level batch writer previously applied items in order;
-- if a later item reused the first item's request ID, the ledger conflict path
-- could return the first row as a successful dedupe without validating the
-- later payload. Reject the ambiguous batch before any adjustment is written.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_adjust_usage_batch_checked(
  p_actor_user_id UUID,
  p_actor_email TEXT,
  p_target_user_id UUID,
  p_reason TEXT,
  p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_item JSONB;
  v_results JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'usage_adjustment_batch_required' USING ERRCODE = '22023';
  END IF;

  -- Idempotency is scoped by (target user, metric, request ID). Validate the
  -- batch itself before the first write so two conflicting items cannot both
  -- pass the wrapper's persisted-replay preflight while the ledger is empty.
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        NULLIF(TRIM(value ->> 'metricKey'), '') AS metric_key,
        NULLIF(TRIM(value ->> 'requestId'), '') AS request_id,
        COUNT(*) AS item_count
      FROM jsonb_array_elements(p_items)
      GROUP BY
        NULLIF(TRIM(value ->> 'metricKey'), ''),
        NULLIF(TRIM(value ->> 'requestId'), '')
      HAVING COUNT(*) > 1
    ) duplicates
    WHERE duplicates.metric_key IS NOT NULL
      AND duplicates.request_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'usage_adjustment_batch_duplicate_request_id'
      USING ERRCODE = '22023',
            DETAIL = 'Each metric/request ID pair may appear only once in an adjustment batch.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_result := public.admin_adjust_usage_checked(
      p_actor_user_id,
      p_actor_email,
      p_target_user_id,
      v_item->>'metricKey',
      (v_item->>'delta')::NUMERIC,
      v_item->>'action',
      (v_item->>'windowStart')::TIMESTAMPTZ,
      NULLIF(v_item->>'windowEnd', '')::TIMESTAMPTZ,
      p_reason,
      v_item->>'requestId',
      (v_item->>'expectedAdjustmentTotal')::NUMERIC,
      COALESCE(v_item->'context', '{}'::jsonb)
    );
    v_results := v_results || jsonb_build_array(jsonb_build_object('key', v_item->>'metricKey') || v_result);
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'results', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_checked(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_usage_batch_checked(UUID, TEXT, UUID, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_checked(UUID, TEXT, UUID, TEXT, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
