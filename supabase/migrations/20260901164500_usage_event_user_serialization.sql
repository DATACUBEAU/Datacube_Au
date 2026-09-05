-- Serialize authoritative event-backed usage mutations through the same per-user
-- accounting boundary used by AI accounting and privileged usage corrections.
-- Preserve the canonical track_usage_event RPC contract introduced by
-- 20260315113000_limits_usage_tracking_enforcement.sql, including authenticated
-- own-user/Conex-admin callers and the optional occurred-at timestamp.

BEGIN;

ALTER FUNCTION public.track_usage_event(
  UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TIMESTAMPTZ
) RENAME TO track_usage_event_user_serialized_unchecked;

REVOKE ALL ON FUNCTION public.track_usage_event_user_serialized_unchecked(
  UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.track_usage_event(
  p_user_id UUID,
  p_event_key TEXT,
  p_feature TEXT,
  p_source TEXT DEFAULT 'server',
  p_metrics JSONB DEFAULT '{}'::jsonb,
  p_request_id TEXT DEFAULT NULL,
  p_correlation_id TEXT DEFAULT NULL,
  p_context JSONB DEFAULT '{}'::jsonb,
  p_occurred_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required' USING ERRCODE = '22023';
  END IF;

  -- Match the canonical RPC authorization contract before allowing an untrusted
  -- caller to wait on the shared accounting lock. The delegated implementation
  -- retains the same checks as a defense-in-depth boundary.
  IF v_role <> 'service_role' THEN
    IF v_requester IS NULL THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
    END IF;
    IF v_requester <> p_user_id AND NOT public.is_conex_admin(v_requester) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- This outer boundary must precede the event insert (whose trigger advances
  -- the mutation version), usage counter updates, and any snapshot reads inside
  -- the delegated canonical implementation.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(concat_ws('|', 'usage_accounting_user', p_user_id::TEXT), 0)
  );

  RETURN public.track_usage_event_user_serialized_unchecked(
    p_user_id,
    p_event_key,
    p_feature,
    p_source,
    p_metrics,
    p_request_id,
    p_correlation_id,
    p_context,
    p_occurred_at
  );
END;
$$;

-- Preserve the canonical public RPC grants while preventing direct access to
-- the renamed implementation.
REVOKE ALL ON FUNCTION public.track_usage_event(
  UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.track_usage_event(
  UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
