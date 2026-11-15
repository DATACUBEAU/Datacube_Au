-- Preserve the legacy admin-session RPC contract after PUBLIC/anon execution is removed.
-- Each routine independently validates the unguessable, active admin session id.
GRANT EXECUTE ON FUNCTION public.admin_count_auth_users(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_users(uuid, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.au_admin_db_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(text, boolean, text, text, text, jsonb) TO authenticated, service_role;
