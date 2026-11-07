-- Restrict administrative usage mutation RPCs to the trusted server boundary.
--
-- Conex HTTP routes authenticate and authorize the human admin first, then use
-- createSupabaseAdminClient() for durable usage reads/writes. Keeping these
-- mutation RPCs callable directly by the generic authenticated PostgREST role
-- lets an otherwise-authorized admin bypass server-owned canonical snapshot,
-- entitlement, reset-window, and legacy-baseline derivation and supply mutable
-- context (including previous_usage) directly. The service-role boundary keeps
-- one authoritative mutation path without changing the RPC contracts used by
-- the server or introducing a second metering subsystem.

BEGIN;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_versioned(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_versioned(
  UUID, TEXT, UUID, TEXT, NUMERIC, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, NUMERIC, BIGINT, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_batch_versioned(
  UUID, TEXT, UUID, TEXT, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_batch_versioned(
  UUID, TEXT, UUID, TEXT, BIGINT, JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_usage_reset_all_versioned(
  UUID, TEXT, UUID, TEXT, TEXT, BIGINT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_usage_reset_all_versioned(
  UUID, TEXT, UUID, TEXT, TEXT, BIGINT, JSONB
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
