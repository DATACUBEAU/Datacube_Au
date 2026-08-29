-- Retire the obsolete unversioned admin usage adjustment entry point.
--
-- New admin correction flows use the versioned RPCs, which serialize against
-- live usage mutation versions and validate replay fingerprints. Keeping the
-- original SECURITY DEFINER function executable by authenticated users would
-- leave a PostgREST path that bypasses those protections.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_adjust_usage(
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
  JSONB
) FROM authenticated;

-- Preserve service-role execution only for controlled server-side rollback or
-- compatibility work. Ordinary Conex/admin requests must use the guarded,
-- versioned RPC surface instead.
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage(
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
  JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
