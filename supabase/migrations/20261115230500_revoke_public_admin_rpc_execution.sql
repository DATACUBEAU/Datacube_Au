-- Remove inherited PUBLIC execute as well as direct anon grants on admin-session RPCs.
REVOKE ALL PRIVILEGES ON FUNCTION public.admin_count_auth_users(uuid) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.admin_list_auth_users(uuid,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.au_admin_db_stats(uuid) FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_feature_flag(text,boolean,text,text,text,jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_count_auth_users(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_users(uuid,text,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.au_admin_db_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(text,boolean,text,text,text,jsonb) TO authenticated, service_role;
