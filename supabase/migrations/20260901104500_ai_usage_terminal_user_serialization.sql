-- Extend the canonical per-user accounting serialization boundary to the
-- interactive AI reservation lifecycle. reserve_ai_usage already enters this
-- boundary before admission; begin/commit/release must do the same before they
-- can lock usage counters/reservations or emit terminal usage state.
--
-- The batch expiry reaper is intentionally not wrapped here because it spans
-- multiple users. It needs deterministic per-user locking inside its candidate
-- batch rather than one opaque outer wrapper; that remains a separate change.

BEGIN;

ALTER FUNCTION public.begin_ai_usage_reservation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) RENAME TO begin_ai_usage_reservation_user_serialized_unchecked;

REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation_user_serialized_unchecked(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.begin_ai_usage_reservation(
  p_reservation_id UUID,
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_user_id::TEXT), 0)
  );

  RETURN public.begin_ai_usage_reservation_user_serialized_unchecked(
    p_reservation_id,
    p_user_id,
    p_feature_key,
    p_route,
    p_idempotency_key,
    p_ticket_id,
    p_provider,
    p_model
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_ai_usage_reservation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_ai_usage_reservation(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

ALTER FUNCTION public.commit_ai_usage(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) RENAME TO commit_ai_usage_user_serialized_unchecked;

REVOKE ALL ON FUNCTION public.commit_ai_usage_user_serialized_unchecked(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commit_ai_usage(
  p_reservation_id UUID,
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT NULL,
  p_model TEXT DEFAULT NULL
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_user_id::TEXT), 0)
  );

  RETURN public.commit_ai_usage_user_serialized_unchecked(
    p_reservation_id,
    p_user_id,
    p_feature_key,
    p_route,
    p_idempotency_key,
    p_ticket_id,
    p_provider,
    p_model
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_ai_usage(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ai_usage(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

ALTER FUNCTION public.release_ai_usage(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) RENAME TO release_ai_usage_user_serialized_unchecked;

REVOKE ALL ON FUNCTION public.release_ai_usage_user_serialized_unchecked(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.release_ai_usage(
  p_reservation_id UUID,
  p_user_id UUID,
  p_feature_key TEXT,
  p_route TEXT,
  p_idempotency_key TEXT,
  p_ticket_id TEXT DEFAULT NULL,
  p_failure_code TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'released'
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_user_id::TEXT), 0)
  );

  RETURN public.release_ai_usage_user_serialized_unchecked(
    p_reservation_id,
    p_user_id,
    p_feature_key,
    p_route,
    p_idempotency_key,
    p_ticket_id,
    p_failure_code,
    p_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.release_ai_usage(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_usage(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
