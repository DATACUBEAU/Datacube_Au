-- Restrict billing and admin SECURITY DEFINER state transitions to trusted
-- server-side callers. These functions can grant/revoke paid access or read auth.users.
REVOKE ALL ON FUNCTION public.approve_manual_payment(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_manual_payment(uuid, uuid, text)
  TO service_role;
ALTER FUNCTION public.approve_manual_payment(uuid, uuid, text)
  SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.apply_verified_billing_payment(
  uuid, text, bigint, text, text, timestamptz, jsonb, text, jsonb, text,
  text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_billing_payment(
  uuid, text, bigint, text, text, timestamptz, jsonb, text, jsonb, text,
  text, text, text, text, text, text, text, text, text, text, text
) TO service_role;
ALTER FUNCTION public.apply_verified_billing_payment(
  uuid, text, bigint, text, text, timestamptz, jsonb, text, jsonb, text,
  text, text, text, text, text, text, text, text, text, text, text
) SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.apply_plan_transition(
  uuid, text, text, timestamptz, text, text, text, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_transition(
  uuid, text, text, timestamptz, text, text, text, text, jsonb, jsonb
) TO service_role;
ALTER FUNCTION public.apply_plan_transition(
  uuid, text, text, timestamptz, text, text, text, text, jsonb, jsonb
) SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION public.admin_set_user_plan_override(
  uuid, text, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_plan_override(
  uuid, text, uuid, text, text, text, text, text
) TO service_role;
ALTER FUNCTION public.admin_set_user_plan_override(
  uuid, text, uuid, text, text, text, text, text
) SET search_path = pg_catalog, public, auth;

REVOKE ALL ON FUNCTION public.admin_count_auth_users(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_count_auth_users(uuid)
  TO service_role;
ALTER FUNCTION public.admin_count_auth_users(uuid)
  SET search_path = pg_catalog, public, auth;

REVOKE ALL ON FUNCTION public.admin_list_auth_users(uuid, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_users(uuid, text, integer, integer)
  TO service_role;
ALTER FUNCTION public.admin_list_auth_users(uuid, text, integer, integer)
  SET search_path = pg_catalog, public, auth;

REVOKE ALL ON FUNCTION public.au_admin_db_stats(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.au_admin_db_stats(uuid)
  TO service_role;
ALTER FUNCTION public.au_admin_db_stats(uuid)
  SET search_path = pg_catalog, public;
