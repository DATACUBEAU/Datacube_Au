-- Reassert the server-only boundary for legacy admin RPCs. The Conex
-- server routes authenticate the operator before using the service-role client.
REVOKE EXECUTE ON FUNCTION public.admin_count_auth_users(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_auth_users(uuid, text, integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.au_admin_db_stats(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_count_auth_users(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_users(uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.au_admin_db_stats(uuid) TO service_role;
