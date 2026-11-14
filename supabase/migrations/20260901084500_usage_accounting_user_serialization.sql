-- Serialize admin usage corrections and AI reservation admission through one
-- per-user accounting boundary before either path acquires quota-window,
-- mutation-version, or counter-row locks. This removes the known cycle where
-- reservation admission held usage_counters/usage_totals while waiting for a
-- quota advisory lock and an admin checkpoint held that advisory/version state
-- while waiting for the same counters.

BEGIN;

ALTER FUNCTION public.reserve_ai_usage(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) RENAME TO reserve_ai_usage_user_serialized_unchecked;

REVOKE ALL ON FUNCTION public.reserve_ai_usage_user_serialized_unchecked(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_ai_usage(
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_request_fingerprint TEXT DEFAULT '',
  p_metric_increments JSONB DEFAULT '{}'::jsonb,
  p_limit_checks JSONB DEFAULT '[]'::jsonb,
  p_estimated_units INTEGER DEFAULT 1,
  p_ticket_id TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ai_usage_require_service_role();

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'USAGE_USER_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- This lock must be the first mutable accounting serialization primitive.
  -- Admin correction wrappers acquire the identical key before request/window
  -- advisory locks and before mutation-version/checkpoint work.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_user_id::TEXT), 0)
  );

  RETURN public.reserve_ai_usage_user_serialized_unchecked(
    p_user_id,
    p_feature_key,
    p_route,
    p_idempotency_key,
    p_request_fingerprint,
    p_metric_increments,
    p_limit_checks,
    p_estimated_units,
    p_ticket_id,
    p_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_usage(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(
  UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, INTEGER, TEXT, TIMESTAMPTZ
) TO service_role;

ALTER FUNCTION public.admin_adjust_usage_versioned(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) RENAME TO admin_adjust_usage_versioned_user_serialized_unchecked;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned_user_serialized_unchecked(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated, service_role;

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
BEGIN
  -- Authenticate before allowing an untrusted caller to hold the shared lock.
  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL OR v_requester <> p_actor_user_id OR NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_target_user_id::TEXT), 0)
  );

  RETURN public.admin_adjust_usage_versioned_user_serialized_unchecked(
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
    p_expected_usage_version,
    p_context
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) TO authenticated, service_role;

ALTER FUNCTION public.admin_adjust_usage_batch_versioned(
  UUID, TEXT, UUID, TEXT, BIGINT, JSONB
) RENAME TO admin_adjust_usage_batch_versioned_user_serialized_unchecked;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned_user_serialized_unchecked(
  UUID, TEXT, UUID, TEXT, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated, service_role;

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
BEGIN
  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL OR v_requester <> p_actor_user_id OR NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_usage_adjustment' USING ERRCODE = '22023';
  END IF;

  -- Batch request/window locks remain deterministic inside the delegated
  -- implementation, but no AI admission can own counter rows while waiting on
  -- one of those narrower locks for this same user.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_target_user_id::TEXT), 0)
  );

  RETURN public.admin_adjust_usage_batch_versioned_user_serialized_unchecked(
    p_actor_user_id,
    p_actor_email,
    p_target_user_id,
    p_reason,
    p_expected_usage_version,
    p_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(
  UUID, TEXT, UUID, TEXT, BIGINT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(
  UUID, TEXT, UUID, TEXT, BIGINT, JSONB
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
