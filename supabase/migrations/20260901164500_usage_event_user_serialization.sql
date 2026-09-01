-- Serialize authoritative event-backed usage mutations through the same per-user
-- accounting boundary used by AI accounting and privileged usage corrections.
-- This prevents a lock-order cycle where track_usage_event owns the mutation
-- version before waiting on counters while AI settlement owns counters before
-- waiting on the mutation version.

BEGIN;

ALTER FUNCTION public.track_usage_event(
  UUID, TEXT, NUMERIC, TEXT, JSONB
) RENAME TO track_usage_event_user_serialized_unchecked;

REVOKE ALL ON FUNCTION public.track_usage_event_user_serialized_unchecked(
  UUID, TEXT, NUMERIC, TEXT, JSONB
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.track_usage_event(
  p_user_id UUID,
  p_metric TEXT,
  p_delta NUMERIC,
  p_idempotency_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(metric TEXT, current_period NUMERIC, current_total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Authenticate before permitting an untrusted caller to wait on the shared
  -- accounting lock. The delegated implementation retains its own guard too.
  IF NOT public.has_service_role_access() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'usage_event_user_required' USING ERRCODE = '22023';
  END IF;

  -- This must precede the request-id lock, mutation-version row, usage counters,
  -- totals, and event-ledger mutation inside the delegated implementation.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_user_id::TEXT), 0)
  );

  RETURN QUERY
  SELECT *
  FROM public.track_usage_event_user_serialized_unchecked(
    p_user_id,
    p_metric,
    p_delta,
    p_idempotency_key,
    p_metadata
  );
END;
$$;

-- Preserve the existing public RPC contract while preventing direct access to
-- the renamed implementation. The implementation itself still requires the
-- service-role claim, so the authenticated grant does not weaken authorization.
REVOKE ALL ON FUNCTION public.track_usage_event(
  UUID, TEXT, NUMERIC, TEXT, JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_usage_event(
  UUID, TEXT, NUMERIC, TEXT, JSONB
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
