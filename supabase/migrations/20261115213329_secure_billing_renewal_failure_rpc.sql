-- Restrict renewal-failure state transitions to trusted server-side callers.
-- The function can expire subscriptions and revoke paid entitlements; browser roles
-- must never be able to invoke it or read/write its audit table directly.

ALTER TABLE public.billing_renewal_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.billing_renewal_attempts
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.billing_renewal_attempts
  TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.apply_billing_renewal_failure(
  uuid, text, text, text, text, integer, text, timestamptz, boolean, jsonb, bigint, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_billing_renewal_failure(
  uuid, text, text, text, text, integer, text, timestamptz, boolean, jsonb, bigint, text, text
) TO service_role;

ALTER FUNCTION public.apply_billing_renewal_failure(
  uuid, text, text, text, text, integer, text, timestamptz, boolean, jsonb, bigint, text, text
) SET search_path = pg_catalog, public;
