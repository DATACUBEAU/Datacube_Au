-- Final guard for the server-side admin read RPCs.
-- A prior main-branch migration temporarily restored authenticated EXECUTE;
-- the supported admin portal now calls these through its server-side service role.
REVOKE ALL PRIVILEGES ON FUNCTION public.admin_count_auth_users(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.admin_list_auth_users(uuid,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.au_admin_db_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_count_auth_users(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_users(uuid,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.au_admin_db_stats(uuid) TO service_role;
