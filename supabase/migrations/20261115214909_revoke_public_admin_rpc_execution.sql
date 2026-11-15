-- Remove inherited PUBLIC/anon execute while preserving the authenticated admin-session
-- RPC contract. Each admin RPC validates its own active session token.
DO $$
DECLARE v_fn text;
BEGIN
  FOR v_fn IN SELECT unnest(ARRAY[
    'public.admin_count_auth_users(uuid)',
    'public.admin_list_auth_users(uuid,text,integer,integer)',
    'public.au_admin_db_stats(uuid)',
    'public.set_feature_flag(text,boolean,text,text,text,jsonb)'
  ])
  LOOP
    IF to_regprocedure(v_fn) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon', v_fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);
    END IF;
  END LOOP;
END;
$$;
