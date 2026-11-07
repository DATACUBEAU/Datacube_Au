-- Restrict internal admin usage implementation RPCs to service-role callers only.
--
-- Authenticated Conex admins must enter through the versioned wrappers so every
-- correction serializes against live usage versions and runs replay-fingerprint
-- and legacy-baseline guards. The checked RPCs remain implementation details used
-- transactionally by those SECURITY DEFINER wrappers.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_usage_checked(
  UUID,
  TEXT,
  UUID,
  TEXT,
  NUMERIC,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  NUMERIC,
  JSONB
) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_usage_batch_checked(
  UUID,
  TEXT,
  UUID,
  TEXT,
  JSONB
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_checked(
  UUID,
  TEXT,
  UUID,
  TEXT,
  NUMERIC,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  NUMERIC,
  JSONB
) TO service_role;

GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_checked(
  UUID,
  TEXT,
  UUID,
  TEXT,
  JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
